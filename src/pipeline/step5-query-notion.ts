import log from '@apify/log';

import type { NotionService } from '../services/notion.js';
import type { CommunityHighlight, Initiative } from '../types.js';

export async function queryNotion(
    notionService: NotionService,
): Promise<{ highlights: CommunityHighlight[]; initiatives: Initiative[] }> {
    log.info('Step 5: Querying Notion for community highlights and initiatives...');

    const [highlights, initiatives] = await Promise.all([
        notionService.getCommunityHighlights(1),
        notionService.getActiveInitiatives(),
    ]);

    log.info('Step 5 complete: Notion data fetched.', {
        highlights: highlights.length,
        initiatives: initiatives.length,
    });

    return { highlights, initiatives };
}
