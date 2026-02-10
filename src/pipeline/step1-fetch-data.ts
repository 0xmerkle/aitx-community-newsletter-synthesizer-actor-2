import { Actor } from 'apify';
import { ApifyClient } from 'apify-client';

import log from '@apify/log';

import type { ArticleData, EventData } from '../types.js';
import { normalizeEvent } from '../utils/eventNormalization.js';

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

    for (const item of items) {
        const raw = item as Record<string, unknown>;
        if (raw.type === 'article') {
            if (!raw.url || !raw.headline) {
                log.warning('Skipping article with missing url or headline', { url: raw.url, headline: raw.headline });
                continue;
            }
            articles.push(raw as unknown as ArticleData);
        } else if (raw.type === 'event') {
            events.push(normalizeEvent(raw));
        } else {
            log.debug('Skipping item with unknown type', { type: raw.type });
        }
    }

    log.info(`Step 1 complete: ${articles.length} articles, ${events.length} events.`);
    return { articles, events };
}
