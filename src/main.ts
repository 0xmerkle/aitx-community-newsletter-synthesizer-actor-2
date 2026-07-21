import { Actor } from 'apify';

import log from '@apify/log';

import { validateConfig } from './config.js';
import { fetchData } from './pipeline/step1-fetch-data.js';
import { filterRelevance } from './pipeline/step2-filter-relevance.js';
import { generateSummaries } from './pipeline/step3-generate-summaries.js';
import { generateStories } from './pipeline/step4-generate-stories.js';
import { queryNotion } from './pipeline/step5-query-notion.js';
import { filterEvents } from './pipeline/step6-filter-events.js';
import { synthesizeMetadata } from './pipeline/step7-synthesize-metadata.js';
import { saveOutput } from './pipeline/step8-save-output.js';
import { AnthropicService } from './services/anthropic.js';
import { NotionService } from './services/notion.js';
import type { ActorInput, NewsletterDraft, PipelineState } from './types.js';
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from './utils/checkpoint.js';

await Actor.init();

// Graceful abort handler
Actor.on('aborting', async () => {
    log.info('Actor aborting, saving checkpoint...');
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000);
    });
    await Actor.exit();
});

try {
    validateConfig();

    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);
    if (!input.datasetId) {
        throw new Error('Missing required input: "datasetId"');
    }
    const topStoriesCount = input.topStoriesCount ?? 5;

    const claudeService = new AnthropicService();
    const notionService = new NotionService();

    // Load checkpoint or create fresh state. Do not reuse rawData from a different dataset.
    const checkpoint = await loadCheckpoint();
    if (checkpoint && (input.forceFresh || checkpoint.input.datasetId !== input.datasetId)) {
        log.info('Ignoring existing checkpoint for fresh run', {
            forceFresh: input.forceFresh === true,
            checkpointDatasetId: checkpoint.input.datasetId,
            inputDatasetId: input.datasetId,
        });
        await clearCheckpoint();
    }

    const state: PipelineState = checkpoint && !input.forceFresh && checkpoint.input.datasetId === input.datasetId ? checkpoint : {
        step: 0,
        stepName: 'initialized',
        input,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
    };

    // Step 1: Fetch data
    if (state.step < 1) {
        state.rawData = await fetchData(input.datasetId);
        state.step = 1;
        state.stepName = 'data-fetched';
        await saveCheckpoint(state);
    }

    // Step 2: Filter relevance
    if (state.step < 2) {
        state.relevantArticles = await filterRelevance(state.rawData!.articles, claudeService);
        state.step = 2;
        state.stepName = 'relevance-filtered';
        await saveCheckpoint(state);
    }

    // Step 3: Generate summaries
    if (state.step < 3) {
        state.summaries = await generateSummaries(state.relevantArticles!, topStoriesCount, claudeService);
        state.step = 3;
        state.stepName = 'summaries-generated';
        await saveCheckpoint(state);
    }

    // Step 4: Generate full stories
    if (state.step < 4) {
        state.topStories = await generateStories(state.summaries!, claudeService);
        state.step = 4;
        state.stepName = 'stories-generated';
        await saveCheckpoint(state);
    }

    // Step 5: Query Notion
    if (state.step < 5) {
        state.notionData = await queryNotion(notionService);
        state.step = 5;
        state.stepName = 'notion-queried';
        await saveCheckpoint(state);
    }

    // Step 6: Filter events
    if (state.step < 6) {
        state.filteredEvents = await filterEvents(state.rawData!.events, claudeService);
        state.step = 6;
        state.stepName = 'events-filtered';
        await saveCheckpoint(state);
    }

    // Step 7: Synthesize metadata
    if (state.step < 7) {
        state.metadata = await synthesizeMetadata(
            {
                stories: state.topStories!,
                communityHighlight: state.notionData?.highlights[0],
                initiatives: state.notionData?.initiatives ?? [],
                events: state.filteredEvents!,
            },
            claudeService,
        );
        state.step = 7;
        state.stepName = 'metadata-synthesized';
        await saveCheckpoint(state);
    }

    // Step 8: Save output
    if (state.step < 8) {
        const newsletter: NewsletterDraft = {
            metadata: state.metadata!,
            stories: state.topStories!,
            communityHighlight: state.notionData?.highlights[0],
            initiatives: state.notionData?.initiatives ?? [],
            events: state.filteredEvents!,
            generatedAt: new Date().toISOString(),
            articlesCount: state.topStories!.length,
            eventsCount: state.filteredEvents!.length,
        };

        state.notionPageUrl = await saveOutput(newsletter, notionService, input.webhookUrl);
        state.step = 8;
        state.stepName = 'output-saved';
        await saveCheckpoint(state);
    }

    // Clear checkpoint on success
    await clearCheckpoint();
    log.info('Pipeline completed successfully!', { notionPageUrl: state.notionPageUrl });
} catch (error) {
    log.exception(error as Error, 'Pipeline failed');
    throw error;
}

await Actor.exit();
