import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { ArticleSummary, Story } from '../types.js';

export async function generateStories(summaries: ArticleSummary[], claudeService: AnthropicService): Promise<Story[]> {
    log.info(`Step 4: Generating full stories for ${summaries.length} articles...`);

    const stories: Story[] = [];

    for (const article of summaries) {
        try {
            const story = await claudeService.generateStory(article);
            stories.push(story);
            log.info(`Generated story for: ${article.headline}`);
        } catch (error) {
            log.warning(`Failed to generate story for: ${article.headline}`, { error: String(error) });
        }
    }

    log.info(`Step 4 complete: Generated ${stories.length}/${summaries.length} stories.`);
    return stories;
}
