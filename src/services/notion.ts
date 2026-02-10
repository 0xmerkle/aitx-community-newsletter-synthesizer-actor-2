import { Client } from '@notionhq/client';

import log from '@apify/log';

import { CONFIG } from '../config.js';
import type { CommunityHighlight, Initiative, NewsletterDraft } from '../types.js';

type NotionProperties = Record<
    string,
    {
        type: string;
        title?: { plain_text: string }[];
        rich_text?: { plain_text: string }[];
        url?: string | null;
        date?: { start: string | null } | null;
        checkbox?: boolean;
        select?: { name: string } | null;
        number?: number | null;
        [key: string]: unknown;
    }
>;

export class NotionService {
    private client: Client;

    constructor() {
        this.client = new Client({ auth: CONFIG.NOTION_API_KEY });
    }

    async getCommunityHighlights(count = 1): Promise<CommunityHighlight[]> {
        const response = await this.client.databases.query({
            database_id: CONFIG.NOTION_COMMUNITY_MEMBERS_DB_ID,
            filter: {
                or: [
                    { property: 'Status', select: { equals: 'Approved' } },
                    { property: 'Status', select: { equals: 'Active' } },
                    { property: 'Status', select: { equals: 'Complete' } },
                ],
            },
            sorts: [
                { property: 'Last Highlighted', direction: 'ascending' },
                { property: 'Date Added', direction: 'ascending' },
            ],
            page_size: count,
        });

        log.info(`Fetched ${response.results.length} community highlights from Notion.`);

        return response.results.map((page) => {
            const props = (page as { properties: NotionProperties }).properties;
            return {
                id: page.id,
                name: this.extractTitle(props, 'Name'),
                bio: this.extractRichText(props, 'Bio'),
                achievement: this.extractRichText(props, 'Achievement') || undefined,
                linkedin_url: this.extractUrl(props, 'LinkedIn URL') || this.extractUrl(props, 'LinkedIn') || undefined,
            };
        });
    }

    async updateLastHighlighted(pageId: string): Promise<void> {
        await this.client.pages.update({
            page_id: pageId,
            properties: {
                'Last Highlighted': {
                    date: { start: new Date().toISOString().split('T')[0] },
                },
            },
        });
        log.info(`Updated "Last Highlighted" for page ${pageId}`);
    }

    async getActiveInitiatives(): Promise<Initiative[]> {
        const today = new Date().toISOString().split('T')[0];

        const response = await this.client.databases.query({
            database_id: CONFIG.NOTION_INITIATIVES_DB_ID,
            filter: {
                and: [
                    { property: 'Active This Week', checkbox: { equals: true } },
                    {
                        or: [
                            { property: 'Status', select: { equals: 'Approved' } },
                            { property: 'Status', select: { equals: 'Active' } },
                        ],
                    },
                    {
                        or: [
                            { property: 'End Date', date: { on_or_after: today } },
                            { property: 'End Date', date: { is_empty: true } },
                        ],
                    },
                ],
            },
            sorts: [{ property: 'Start Date', direction: 'descending' }],
        });

        log.info(`Fetched ${response.results.length} active initiatives from Notion.`);

        return response.results.map((page) => {
            const props = (page as { properties: NotionProperties }).properties;
            return {
                id: page.id,
                title: this.extractTitle(props, 'Title') || this.extractTitle(props, 'Name'),
                description: this.extractRichText(props, 'Description'),
                start_date: this.extractDate(props, 'Start Date') || undefined,
                end_date: this.extractDate(props, 'End Date') || undefined,
                contact: this.extractRichText(props, 'Contact') || undefined,
                url: this.extractUrl(props, 'URL') || this.extractUrl(props, 'Link') || undefined,
            };
        });
    }

    async updateLastFeatured(pageId: string): Promise<void> {
        await this.client.pages.update({
            page_id: pageId,
            properties: {
                'Last Featured': {
                    date: { start: new Date().toISOString().split('T')[0] },
                },
            },
        });
        log.info(`Updated "Last Featured" for page ${pageId}`);
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

        if (newsletter.communityHighlight) {
            properties['Highlighted Member'] = {
                rich_text: [{ text: { content: newsletter.communityHighlight.name } }],
            };
        }

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
        const openingContent = `# ${newsletter.metadata.title}\n\n${newsletter.metadata.opening}`;
        blocks.push(this.createCodeBlock(openingContent));

        // Top Stories
        blocks.push(this.createHeading('Top Stories'));
        for (const story of newsletter.stories) {
            const storyContent = [
                `## ${story.headline}`,
                `[Read more](${story.url})`,
                '',
                story.summary,
                '',
                `**Why it matters:** ${story.why_it_matters}`,
                '',
                '**Need to know:**',
                ...story.need_to_know.map((b) => `- ${b}`),
            ].join('\n');
            blocks.push(this.createCodeBlock(storyContent));
        }

        // Community Spotlight
        if (newsletter.communityHighlight) {
            blocks.push(this.createHeading('Community Spotlight'));
            const highlight = newsletter.communityHighlight;
            const highlightContent = [
                `## ${highlight.name}`,
                '',
                highlight.bio,
                highlight.achievement ? `\n**Achievement:** ${highlight.achievement}` : '',
                highlight.linkedin_url ? `\n[LinkedIn](${highlight.linkedin_url})` : '',
            ]
                .filter(Boolean)
                .join('\n');
            blocks.push(this.createCodeBlock(highlightContent));
        }

        // Community Initiatives
        if (newsletter.initiatives.length > 0) {
            blocks.push(this.createHeading('Community Initiatives'));
            for (const initiative of newsletter.initiatives) {
                const initiativeContent = [
                    `## ${initiative.title}`,
                    '',
                    initiative.description,
                    initiative.url ? `\n[Learn more](${initiative.url})` : '',
                    initiative.contact ? `\n**Contact:** ${initiative.contact}` : '',
                ]
                    .filter(Boolean)
                    .join('\n');
                blocks.push(this.createCodeBlock(initiativeContent));
            }
        }

        // Upcoming Events
        if (newsletter.events.length > 0) {
            blocks.push(this.createHeading('Upcoming Events'));
            for (const event of newsletter.events) {
                const eventContent = [
                    `## ${event.title}`,
                    event.url ? `[RSVP](${event.url})` : '',
                    '',
                    `**When:** ${event.when}`,
                    `**Where:** ${event.where}`,
                    `**What:** ${event.what}`,
                ]
                    .filter(Boolean)
                    .join('\n');
                blocks.push(this.createCodeBlock(eventContent));
            }
        }

        // Closing
        blocks.push(this.createCodeBlock(newsletter.metadata.closing));

        return blocks;
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

    private extractTitle(props: NotionProperties, key: string): string {
        const prop = props[key] || props[key.toLowerCase()];
        if (prop?.type === 'title' && Array.isArray(prop.title) && prop.title.length > 0) {
            return prop.title[0].plain_text;
        }
        return 'Unknown';
    }

    private extractRichText(props: NotionProperties, key: string): string {
        const prop = props[key] || props[key.toLowerCase()];
        if (prop?.type === 'rich_text' && Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
            return prop.rich_text.map((t) => t.plain_text).join('');
        }
        return '';
    }

    private extractUrl(props: NotionProperties, key: string): string | null {
        const prop = props[key] || props[key.toLowerCase()];
        if (prop?.type === 'url') {
            return prop.url || null;
        }
        return null;
    }

    private extractDate(props: NotionProperties, key: string): string | null {
        const prop = props[key] || props[key.toLowerCase()];
        if (prop?.type === 'date' && prop.date) {
            return prop.date.start;
        }
        return null;
    }
}
