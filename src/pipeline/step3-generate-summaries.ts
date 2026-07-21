import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { ArticleSummary, RelevantArticle } from '../types.js';

export async function generateSummaries(
    articles: RelevantArticle[],
    topStoriesCount: number,
    claudeService: AnthropicService,
): Promise<ArticleSummary[]> {
    const selected = articles.slice(0, topStoriesCount);
    log.info(`Step 3: Generating summaries for ${selected.length} articles...`);

    if (selected.length === 0) {
        log.warning('Step 3 complete: No relevant articles to summarize.');
        return [];
    }

    const summaries = await claudeService.generateSummaries(selected);

    log.info(`Step 3 complete: Generated ${summaries.length}/${selected.length} summaries.`);
    return summaries;
}
