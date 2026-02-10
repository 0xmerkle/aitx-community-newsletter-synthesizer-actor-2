import dotenv from 'dotenv';

import log from '@apify/log';

if (!process.env.APIFY_IS_AT_HOME) {
    dotenv.config({ path: '.env.local' });
    dotenv.config({ path: '.env' });
}

export const CONFIG = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    NOTION_API_KEY: process.env.NOTION_API_KEY || '',
    NOTION_COMMUNITY_MEMBERS_DB_ID: process.env.NOTION_COMMUNITY_MEMBERS_DB_ID || '',
    NOTION_INITIATIVES_DB_ID: process.env.NOTION_INITIATIVES_DB_ID || '',
    NOTION_DRAFTS_DB_ID: process.env.NOTION_DRAFTS_DB_ID || '',
    CLAUDE_MODEL: 'claude-sonnet-4-5-20250929' as const,
    CLAUDE_HAIKU_MODEL: 'claude-haiku-4-5-20251001' as const,
    RATE_LIMIT_DELAY_MS: 500,
} as const;

export function validateConfig(): void {
    const required: [string, string][] = [
        ['ANTHROPIC_API_KEY', CONFIG.ANTHROPIC_API_KEY],
        ['NOTION_API_KEY', CONFIG.NOTION_API_KEY],
        ['NOTION_COMMUNITY_MEMBERS_DB_ID', CONFIG.NOTION_COMMUNITY_MEMBERS_DB_ID],
        ['NOTION_INITIATIVES_DB_ID', CONFIG.NOTION_INITIATIVES_DB_ID],
        ['NOTION_DRAFTS_DB_ID', CONFIG.NOTION_DRAFTS_DB_ID],
    ];

    const missing = required.filter(([, value]) => !value).map(([name]) => name);

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}. Set them in Apify Console or .env.local for local development.`,
        );
    }

    log.info('Configuration validated successfully.');
}
