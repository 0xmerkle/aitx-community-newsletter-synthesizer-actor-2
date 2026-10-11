import { Client } from '@notionhq/client';

import log from '@apify/log';

import { CONFIG } from '../config.js';
import type { NewsletterDraft, Rejection } from '../types.js';

export class NotionService {
    private client: Client;

    constructor() {
        this.client = new Client({ auth: CONFIG.NOTION_API_KEY });
    }

    async createDraftPage(newsletter: NewsletterDraft, runUrl?: string): Promise<string> {
        const blocks = this.buildNewsletterBlocks(newsletter);

        const properties: Record<string, unknown> = {
            Title: { title: [{ text: { content: newsletter.metadata.title } }] },
            'Subject Line': { rich_text: [{ text: { content: newsletter.metadata.subject_line } }] },
            'Preview Text': { rich_text: [{ text: { content: newsletter.metadata.preview_text } }] },
            Status: { select: { name: 'Draft' } },
            'Draft Date': { date: { start: new Date().toISOString().split('T')[0] } },
            'Articles Count': { number: newsletter.articlesCount },
        };

        if (runUrl) {
            properties['Apify Run URL'] = { url: runUrl };
        }

        const response = await this.client.pages.create({
            parent: { database_id: CONFIG.NOTION_DRAFTS_DB_ID },
            properties: properties as Parameters<typeof this.client.pages.create>[0]['properties'],
            children: blocks as Parameters<typeof this.client.pages.create>[0]['children'],
        });

        const pageUrl = (response as { url?: string }).url || `https://notion.so/${response.id.replace(/-/g, '')}`;
        log.info(`Created Notion draft page: ${pageUrl}`);
        return pageUrl;
    }

    private buildNewsletterBlocks(newsletter: NewsletterDraft): unknown[] {
        const blocks: unknown[] = [];

        // Opening
        blocks.push(this.createHeading('Intro'));
        const openingContent = `# ${newsletter.metadata.title}\n\n${newsletter.metadata.opening}`;
        blocks.push(this.createCodeBlock(openingContent));

        // Top Stories
        blocks.push(this.createHeading('Top Stories'));
        for (const story of newsletter.stories) {
            const storyContent = [
                `## ${story.headline}`,
                '',
                story.summary,
                '',
                `Why it matters: ${story.why_it_matters}`,
                '',
                'Need to know:',
                ...story.need_to_know.map((b) => `- ${b}`),
                '',
                `[Read more here](${story.url})`,
            ].join('\n');
            blocks.push(this.createCodeBlock(storyContent));
        }

        // Upcoming Events
        if (newsletter.events.length > 0) {
            blocks.push(this.createHeading('Upcoming Events'));
            for (const event of newsletter.events) {
                const eventContent = [
                    `## ${event.title}`,
                    event.url ? `[RSVP](${event.url})` : '',
                    '',
                    `When: ${event.when}`,
                    `Where: ${event.where}`,
                    `What: ${event.what}`,
                ]
                    .filter(Boolean)
                    .join('\n');
                blocks.push(this.createCodeBlock(eventContent));
            }
        }

        // Closing
        blocks.push(this.createHeading('Closing'));
        blocks.push(this.createCodeBlock(newsletter.metadata.closing));

        // Filter log: what the pipeline dropped and why. Not for publishing.
        if (newsletter.rejections.length > 0) {
            blocks.push(this.createHeading('Filter log (not for publishing)'));
            for (const kind of ['article', 'event'] as const) {
                const items = newsletter.rejections.filter((r) => r.kind === kind);
                if (items.length === 0) continue;
                blocks.push(this.createToggle(`Rejected ${kind}s (${items.length})`, items.map((r) => this.createRejectionItem(r))));
            }
        }

        return blocks;
    }

    private createToggle(text: string, children: unknown[]): unknown {
        return {
            object: 'block',
            type: 'toggle',
            toggle: {
                rich_text: [{ type: 'text', text: { content: text } }],
                // Notion caps children per request at 100
                children: children.slice(0, 100),
            },
        };
    }

    private createRejectionItem(rejection: Rejection): unknown {
        const title = rejection.title.slice(0, 200);
        return {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
                rich_text: [
                    {
                        type: 'text',
                        text: { content: title, link: rejection.url ? { url: rejection.url } : null },
                    },
                    { type: 'text', text: { content: ` — ${rejection.reason}`.slice(0, 1800) } },
                ],
            },
        };
    }

    private createCodeBlock(content: string): unknown {
        const truncated = content.slice(0, 2000);
        return {
            object: 'block',
            type: 'code',
            code: {
                rich_text: [{ type: 'text', text: { content: truncated } }],
                language: 'markdown',
            },
        };
    }

    private createHeading(text: string): unknown {
        return {
            object: 'block',
            type: 'heading_2',
            heading_2: {
                rich_text: [{ type: 'text', text: { content: text } }],
            },
        };
    }
}
