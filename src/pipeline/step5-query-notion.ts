import log from '@apify/log';

import type { NotionService } from '../services/notion.js';
import type { CommunityHighlight, Initiative } from '../types.js';

export async function queryNotion(
    notionService: NotionService,
): Promise<{ highlights: CommunityHighlight[]; initiatives: Initiative[] }> {
    log.info('Step 5: Querying Notion for community content...');

    const highlights = await notionService.getCommunityHighlights(1);

    if (highlights.length > 0) {
        await notionService.updateLastHighlighted(highlights[0].id);
    }

    const initiatives = await notionService.getActiveInitiatives();

    for (const initiative of initiatives) {
        try {
            await notionService.updateLastFeatured(initiative.id);
        } catch (error) {
            log.warning(`Failed to update "Last Featured" for initiative: ${initiative.title}`, {
                error: String(error),
            });
        }
    }

    log.info(`Step 5 complete: ${highlights.length} highlights, ${initiatives.length} initiatives.`);
    return { highlights, initiatives };
}
