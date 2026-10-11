import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { FilteredEvent, NewsletterMetadata, Story } from '../types.js';

export async function synthesizeMetadata(
    data: {
        stories: Story[];
        events: FilteredEvent[];
    },
    claudeService: AnthropicService,
    issueDate: string,
): Promise<NewsletterMetadata> {
    log.info('Step 7: Synthesizing newsletter metadata...');

    const metadata = await claudeService.synthesizeMetadata(data, issueDate);

    log.info(`Step 7 complete: Title="${metadata.title}", Subject="${metadata.subject_line}"`);
    return metadata;
}
