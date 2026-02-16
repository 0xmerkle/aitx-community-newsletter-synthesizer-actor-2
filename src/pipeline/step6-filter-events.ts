import { nextFriday } from 'date-fns';

import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { EventData, FilteredEvent } from '../types.js';
import { formatEventDateTime } from '../utils/dateFormatting.js';
import { enrichFromLuma } from '../utils/lumaEnrichment.js';
import { removeEmDashes } from '../utils/textFormatting.js';

export async function filterEvents(events: EventData[], claudeService: AnthropicService): Promise<FilteredEvent[]> {
    log.info(`Step 6: Filtering ${events.length} events...`);

    // Pass 1: Date filter - only events on or after next Friday
    const nextFri = nextFriday(new Date());
    const nextFriStr = nextFri.toISOString().split('T')[0];

    let filtered = events.filter((e) => {
        if (!e.start_date) {
            log.debug(`Skipping event without start_date: ${e.title}`);
            return false;
        }
        return e.start_date >= nextFriStr;
    });
    log.info(`After date filter (>= ${nextFriStr}): ${filtered.length} events`);

    // Pass 2: Virtual filter - skip virtual events
    filtered = filtered.filter((e) => {
        if (e.is_virtual === true) {
            log.debug(`Skipping virtual event: ${e.title}`);
            return false;
        }
        return true;
    });
    log.info(`After virtual filter: ${filtered.length} events`);

    // Pass 3: AI relevance filter
    if (filtered.length > 0) {
        try {
            filtered = await claudeService.filterEventRelevance(filtered);
            log.info(`After AI relevance filter: ${filtered.length} events`);
        } catch (error) {
            log.warning('AI event relevance filter failed, using all events', { error: String(error) });
        }
    }

    // Pass 4: Lu.ma enrichment for events missing data
    const enriched: EventData[] = [];
    for (const event of filtered) {
        if (event.source === 'lu.ma' || (event.url && event.url.includes('lu.ma'))) {
            if (!event.end_time || !event.location) {
                const result = await enrichFromLuma(event);
                let enrichedEvent = result.event;

                // Summarize Lu.ma ProseMirror description if available and event has no description
                if (result.descriptionContent && !enrichedEvent.description) {
                    try {
                        enrichedEvent = {
                            ...enrichedEvent,
                            description: await claudeService.summarizeLumaDescription(result.descriptionContent),
                        };
                    } catch (error) {
                        log.warning(`Failed to summarize Lu.ma description for: ${event.title}`, {
                            error: String(error),
                        });
                    }
                }

                enriched.push(enrichedEvent);
                continue;
            }
        }
        enriched.push(event);
    }

    // Pass 5: Location filter post-enrichment
    const withLocation = enriched.filter((e) => {
        const hasLocation = !!(e.venue_name || e.location || e.city);
        if (!hasLocation) {
            log.debug(`Skipping event without location: ${e.title}`);
        }
        return hasLocation;
    });
    log.info(`After location filter: ${withLocation.length} events`);

    // Pass 6: Format to FilteredEvent
    const formatted: FilteredEvent[] = withLocation.map((e) => {
        log.info(`Formatting event: "${e.title}" | raw date="${e.start_date}" start_time="${e.start_time}" end_time="${e.end_time}"`);
        return {
        title: e.title,
        url: e.url,
        when: formatEventDateTime(e.start_date!, e.start_time, e.end_time),
        where: formatWhere(e),
        what: removeEmDashes(e.description || e.title),
    };
    });

    log.info(`Step 6 complete: ${formatted.length} events after all filters.`);
    return formatted;
}

function formatWhere(event: EventData): string {
    const parts = [event.venue_name, event.city, event.state].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    return event.location || 'Location TBD';
}
