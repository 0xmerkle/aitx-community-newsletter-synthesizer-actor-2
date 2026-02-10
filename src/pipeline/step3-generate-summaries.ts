import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { ArticleSummary, RelevantArticle } from '../types.js';

export async function generateSummaries(
    relevantArticles: RelevantArticle[],
    topStoriesCount: number,
    claudeService: AnthropicService,
): Promise<ArticleSummary[]> {
    log.info(`Step 3: Generating summaries for top ${topStoriesCount} articles...`);

    const sorted = [...relevantArticles].sort((a, b) => {
        if (!a.published_date && !b.published_date) return 0;
        if (!a.published_date) return 1;
        if (!b.published_date) return -1;
        return new Date(b.published_date).getTime() - new Date(a.published_date).getTime();
    });

    const topArticles = sorted.slice(0, topStoriesCount);

    const summaries = await claudeService.generateSummaries(topArticles);

    log.info(`Step 3 complete: Generated ${summaries.length} summaries.`);
    return summaries;
}
