import { Actor } from 'apify';
import { ApifyClient } from 'apify-client';

import log from '@apify/log';

import type { ArticleData, EventData } from '../types.js';
import { normalizeEvent } from '../utils/eventNormalization.js';
import { normalizeUrl } from '../utils/urlNormalization.js';

export async function fetchData(datasetId: string): Promise<{ articles: ArticleData[]; events: EventData[] }> {
    log.info('Step 1: Fetching data from dataset...', { datasetId });

    const token = process.env.APIFY_TOKEN || Actor.getEnv().token;
    if (!token) {
        throw new Error('APIFY_TOKEN is not set. Required to access cloud datasets. Add it to .env or .env.local');
    }
    log.debug('Using Apify token to fetch dataset', { tokenPrefix: token.slice(0, 10) });
    const client = new ApifyClient({ token });
    const { items } = await client.dataset(datasetId).listItems();

    log.info(`Fetched ${items.length} total items from dataset.`);

    const articles: ArticleData[] = [];
    const events: EventData[] = [];
    // Dedupe by normalized URL: the scraper can push the same story twice
    // (RSS + additional URLs, tracking-param variants, re-runs appending to
    // the same dataset).
    const seenArticleUrls = new Set<string>();
    const seenEventUrls = new Set<string>();
    let duplicateCount = 0;

    for (const item of items) {
        const raw = item as Record<string, unknown>;
        if (raw.type === 'article') {
            if (!raw.url || !raw.headline) {
                log.warning('Skipping article with missing url or headline', { url: raw.url, headline: raw.headline });
                continue;
            }
            const normalized = normalizeUrl(raw.url as string);
            if (seenArticleUrls.has(normalized)) {
                duplicateCount++;
                log.debug('Skipping duplicate article', { url: raw.url });
                continue;
            }
            seenArticleUrls.add(normalized);
            articles.push(raw as unknown as ArticleData);
        } else if (raw.type === 'event') {
            const event = normalizeEvent(raw);
            if (event.url) {
                const normalized = normalizeUrl(event.url);
                if (seenEventUrls.has(normalized)) {
                    duplicateCount++;
                    log.debug('Skipping duplicate event', { url: event.url });
                    continue;
                }
                seenEventUrls.add(normalized);
            }
            events.push(event);
        } else {
            log.debug('Skipping item with unknown type', { type: raw.type });
        }
    }

    log.info(`Step 1 complete: ${articles.length} articles, ${events.length} events (${duplicateCount} duplicates removed).`);
    return { articles, events };
}
