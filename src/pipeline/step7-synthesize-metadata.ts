import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { CommunityHighlight, FilteredEvent, Initiative, NewsletterMetadata, Story } from '../types.js';

export async function synthesizeMetadata(
    data: {
        stories: Story[];
        communityHighlight?: CommunityHighlight;
        initiatives: Initiative[];
        events: FilteredEvent[];
    },
    claudeService: AnthropicService,
): Promise<NewsletterMetadata> {
    log.info('Step 7: Synthesizing newsletter metadata...');

    const metadata = await claudeService.synthesizeMetadata(data);

    log.info(`Step 7 complete: Title="${metadata.title}", Subject="${metadata.subject_line}"`);
    return metadata;
}
