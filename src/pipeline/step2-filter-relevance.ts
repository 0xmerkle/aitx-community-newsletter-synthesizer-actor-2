import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { ArticleData, RelevantArticle } from '../types.js';

export async function filterRelevance(
    articles: ArticleData[],
    claudeService: AnthropicService,
): Promise<RelevantArticle[]> {
    log.info(`Step 2: Filtering ${articles.length} articles for relevance...`);

    if (articles.length === 0) {
        log.warning('Step 2 complete: No articles to filter.');
        return [];
    }

    const evaluated = await claudeService.evaluateRelevance(articles);
    const relevant = evaluated
        .filter((article) => article.is_ai_relevant && article.is_texas_relevant)
        .sort((a, b) => b.relevance_score - a.relevance_score);

    log.info(`Step 2 complete: ${relevant.length}/${articles.length} articles are relevant.`);
    return relevant;
}
