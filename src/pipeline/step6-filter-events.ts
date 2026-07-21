import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { EventData, FilteredEvent } from '../types.js';
import { formatEventDateTime } from '../utils/dateFormatting.js';
import { getCentralDateKey, getNewsletterCutoffDateKey, parseEventDate } from '../utils/eventDate.js';
import { enrichFromLuma } from '../utils/lumaEnrichment.js';
import { removeEmDashes } from '../utils/textFormatting.js';

// Events scoring at or above STRICT_SCORE are always kept. If that yields
// fewer than MIN_EVENTS, backfill from AI-adjacent events (>= BACKFILL_SCORE)
// so the newsletter always has enough events when the scrapers found any.
const STRICT_SCORE = 70;
const BACKFILL_SCORE = 40;
const MIN_EVENTS = 5;
const MAX_EVENTS = 8;

export async function filterEvents(events: EventData[], claudeService: AnthropicService): Promise<FilteredEvent[]> {
    log.info(`Step 6: Filtering ${events.length} events...`);

    // Pass 1: Date filter - only events on or after the next newsletter date.
    // If the actor runs on Friday, same-day events remain eligible.
    const cutoffDateKey = getNewsletterCutoffDateKey();
    let missingDateCount = 0;
    let beforeCutoffCount = 0;

    let filtered = events.filter((e) => {
        const startDate = parseEventDate(e.start_date);
        if (!startDate) {
            missingDateCount++;
            log.debug(`Skipping event without start_date: ${e.title}`);
            return false;
        }

        const eventDateKey = getCentralDateKey(startDate);
        if (eventDateKey < cutoffDateKey) {
            beforeCutoffCount++;
            log.debug(`Skipping event before newsletter cutoff: ${e.title}`, {
                startDate: e.start_date,
                eventDateKey,
                cutoffDateKey,
            });
            return false;
        }

        return true;
    });
    log.info(`After date filter (>= ${cutoffDateKey}): ${filtered.length} events`, {
        input: events.length,
        missingDate: missingDateCount,
        beforeCutoff: beforeCutoffCount,
    });

    // Pass 2: Virtual filter - skip virtual events
    filtered = filtered.filter((e) => {
        if (e.is_virtual === true) {
            log.debug(`Skipping virtual event: ${e.title}`);
            return false;
        }
        return true;
    });
    log.info(`After virtual filter: ${filtered.length} events`);

    // Pass 3: Lu.ma enrichment before AI relevance, so Claude can evaluate descriptions.
    const enriched: EventData[] = [];
    for (const event of filtered) {
        if (event.source === 'luma' || event.source === 'lu.ma' || (event.url && event.url.includes('lu.ma'))) {
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
        enriched.push(event);
    }
    log.info(`After Lu.ma enrichment: ${enriched.length} events`);

    // Pass 4: Location filter post-enrichment, before selection so backfill
    // only considers events we can actually print a "Where" for.
    const withLocation = enriched.filter((e) => {
        const hasLocation = !!(e.venue_name || e.location || e.city);
        if (!hasLocation) {
            log.debug(`Skipping event without location: ${e.title}`);
        }
        return hasLocation;
    });
    log.info(`After location filter: ${withLocation.length} events`);

    // Pass 5: Title dedup - the same event is sometimes listed on both Lu.ma and Meetup
    const seenTitles = new Set<string>();
    const deduped = withLocation.filter((e) => {
        const key = e.title.toLowerCase().replace(/\s+/g, ' ').trim();
        if (seenTitles.has(key)) {
            log.debug(`Skipping duplicate event title: ${e.title}`);
            return false;
        }
        seenTitles.add(key);
        return true;
    });
    log.info(`After title dedup: ${deduped.length} events`);

    // Pass 6: AI relevance scoring with tiered selection
    const selected = await selectByRelevance(deduped, claudeService);

    // Pass 7: Sort by start date and format to FilteredEvent
    const formatted: FilteredEvent[] = selected
        .sort((a, b) => (parseEventDate(a.start_date)?.getTime() ?? 0) - (parseEventDate(b.start_date)?.getTime() ?? 0))
        .map((e) => {
            log.info(`Formatting event: "${e.title}" | raw date="${e.start_date}" start_time="${e.start_time}" end_time="${e.end_time}" tz="${e.timezone}"`);
            return {
                title: e.title,
                url: e.url,
                when: formatEventDateTime({
                    start_date: e.start_date!,
                    end_date: e.end_date,
                    start_time: e.start_time,
                    end_time: e.end_time,
                    timezone: e.timezone,
                }),
                where: formatWhere(e),
                what: removeEmDashes(e.description || e.title),
            };
        });

    log.info(`Step 6 complete: ${formatted.length} events after all filters.`);
    return formatted;
}

async function selectByRelevance(events: EventData[], claudeService: AnthropicService): Promise<EventData[]> {
    if (events.length === 0) return [];

    let scores: number[];
    try {
        scores = await claudeService.scoreEventRelevance(events);
    } catch (error) {
        log.warning('AI event relevance scoring failed, using all events', { error: String(error) });
        return events.slice(0, MAX_EVENTS);
    }

    const scored = events.map((event, i) => ({ event, score: scores[i] ?? 0 }));

    const strict = scored.filter((s) => s.score >= STRICT_SCORE);
    let selected = strict;

    if (strict.length < MIN_EVENTS) {
        const backfill = scored
            .filter((s) => s.score >= BACKFILL_SCORE && s.score < STRICT_SCORE)
            .sort((a, b) => b.score - a.score)
            .slice(0, MIN_EVENTS - strict.length);
        if (backfill.length > 0) {
            log.info(
                `Only ${strict.length} events scored >= ${STRICT_SCORE}, backfilling ${backfill.length} AI-adjacent events`,
                { backfillTitles: backfill.map((s) => `${s.event.title} (${s.score})`) },
            );
        }
        selected = [...strict, ...backfill];
    }

    selected = selected.sort((a, b) => b.score - a.score).slice(0, MAX_EVENTS);
    log.info(`After AI relevance selection: ${selected.length} events`, {
        scores: scored.map((s) => `${s.event.title}: ${s.score}`),
    });

    return selected.map((s) => s.event);
}

function formatWhere(event: EventData): string {
    const parts = [event.venue_name, event.city, event.state].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    return event.location || 'Location TBD';
}
