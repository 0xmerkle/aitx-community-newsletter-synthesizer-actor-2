import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { ArticleData, RelevantArticle } from '../types.js';

export async function filterRelevance(
    articles: ArticleData[],
    claudeService: AnthropicService,
): Promise<RelevantArticle[]> {
    log.info(`Step 2: Filtering ${articles.length} articles for relevance...`);

    const evaluated = await claudeService.evaluateRelevance(articles);

    const relevant = evaluated.filter((a) => a.is_ai_relevant && a.is_texas_relevant);

    log.info(`Step 2 complete: ${relevant.length}/${articles.length} articles are relevant (AI + Texas).`);
    return relevant;
}
