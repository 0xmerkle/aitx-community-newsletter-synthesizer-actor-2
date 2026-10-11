import log from '@apify/log';

import type { Judge } from '../services/judge.js';
import type { ArticleData, Rejection, RelevantArticle } from '../types.js';

// Older stories are stale for a weekly. Articles with no date are kept and judged on content.
const ARTICLE_MAX_AGE_DAYS = 10;
// The yes/no checks (AI-focused, concrete Texas link) decide eligibility. The
// score is noisy run to run (the same story lands 50 one run, 65 the next), so
// it ranks stories and only this low floor filters on it.
const MIN_STORY_SCORE = 40;

export async function filterRelevance(
    articles: ArticleData[],
    judge: Judge,
    issueDate: string,
): Promise<{ relevant: RelevantArticle[]; rejected: Rejection[] }> {
    log.info(`Step 2: Filtering ${articles.length} articles for relevance...`);
    const rejected: Rejection[] = [];

    const oldestAllowed = Date.now() - ARTICLE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const fresh = articles.filter((a) => {
        const published = a.published_date ? Date.parse(a.published_date) : NaN;
        if (!Number.isNaN(published) && published < oldestAllowed) {
            rejected.push({
                kind: 'article',
                title: a.headline,
                url: a.url,
                reason: `Older than ${ARTICLE_MAX_AGE_DAYS} days (published ${a.published_date!.slice(0, 10)})`,
            });
            return false;
        }
        return true;
    });
    log.info(`After freshness filter: ${fresh.length}/${articles.length} articles`);

    if (fresh.length === 0) {
        log.warning('Step 2 complete: No articles to filter.');
        return { relevant: [], rejected };
    }

    const evaluated = await judge.evaluateRelevance(fresh, issueDate);
    const relevant: RelevantArticle[] = [];
    for (const article of evaluated) {
        const failed = [
            !article.is_ai_relevant && 'AI is not the main subject',
            !article.is_texas_relevant && 'no concrete Texas connection',
            article.relevance_score < MIN_STORY_SCORE && `score ${article.relevance_score} < ${MIN_STORY_SCORE}`,
        ].filter(Boolean);

        if (failed.length > 0) {
            rejected.push({
                kind: 'article',
                title: article.headline,
                url: article.url,
                reason: `${failed.join('; ')}. ${article.reasoning}`,
            });
            continue;
        }
        relevant.push(article);
    }
    relevant.sort((a, b) => b.relevance_score - a.relevance_score);

    log.info(`Step 2 complete: ${relevant.length}/${articles.length} articles are relevant.`);
    return { relevant, rejected };
}
