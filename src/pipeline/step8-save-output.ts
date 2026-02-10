import { Actor } from 'apify';

import log from '@apify/log';

import type { NotionService } from '../services/notion.js';
import type { NewsletterDraft } from '../types.js';

export async function saveOutput(
    newsletter: NewsletterDraft,
    notionService: NotionService,
    webhookUrl?: string,
): Promise<string> {
    log.info('Step 8: Saving output...');

    // (a) Save to KV store
    await Actor.setValue('newsletter-draft', newsletter);
    log.info('Saved newsletter draft to KV store key "newsletter-draft".');

    // (b) Create Notion draft page
    const runUrl = process.env.APIFY_IS_AT_HOME
        ? `https://console.apify.com/view/runs/${process.env.APIFY_ACTOR_RUN_ID}`
        : undefined;

    const notionPageUrl = await notionService.createDraftPage(newsletter, runUrl);
    log.info(`Created Notion draft page: ${notionPageUrl}`);

    // (c) Push metadata to dataset
    await Actor.pushData({
        title: newsletter.metadata.title,
        subjectLine: newsletter.metadata.subject_line,
        notionPageUrl,
        storiesCount: newsletter.stories.length,
        eventsCount: newsletter.events.length,
        generatedAt: newsletter.generatedAt,
    });
    log.info('Pushed metadata to dataset.');

    // (d) Optional webhook
    if (webhookUrl) {
        try {
            const payload = {
                title: newsletter.metadata.title,
                notionPageUrl,
                storiesCount: newsletter.stories.length,
                eventsCount: newsletter.events.length,
            };
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            log.info(`Webhook POST sent to: ${webhookUrl}`);
        } catch (error) {
            log.warning('Webhook POST failed', { error: String(error) });
        }
    }

    log.info('Step 8 complete: All outputs saved.');
    return notionPageUrl;
}
