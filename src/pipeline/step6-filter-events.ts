import log from '@apify/log';

import type { AnthropicService } from '../services/anthropic.js';
import type { JevService } from '../services/jev.js';
import type { EventData, FilteredEvent, Rejection } from '../types.js';
import { formatEventDateTime } from '../utils/dateFormatting.js';
import { addDaysToDateKey, getCentralDateKey, getNewsletterCutoffDateKey, parseEventDate } from '../utils/eventDate.js';
import { enrichFromLuma } from '../utils/lumaEnrichment.js';
import { cleanCopy } from '../utils/textFormatting.js';

// Events from the issue date through the following week.
const EVENT_WINDOW_DAYS = 7;
// No minimum and no backfill: an event is listed only if it passes every check.
const MAX_EVENTS = 12;
// Fallback length when a description can't be summarized
const MAX_DISPLAY_DESCRIPTION = 300;
// Title token overlap at which two same-day events count as the same listing
const DUPLICATE_TITLE_SIMILARITY = 0.6;

const TEXAS_STATE_VALUES = new Set(['tx', 'texas']);

export async function filterEvents(
    events: EventData[],
    claudeService: AnthropicService,
    jev: JevService,
): Promise<{ events: FilteredEvent[]; rejected: Rejection[] }> {
    log.info(`Step 6: Filtering ${events.length} events...`);
    const rejected: Rejection[] = [];
    const reject = (e: EventData, reason: string) => {
        rejected.push({ kind: 'event', title: e.title, url: e.url, reason });
        log.debug(`Rejected event "${e.title}": ${reason}`);
    };

    // Pass 1: Date window - from the issue date (Friday) through the next week.
    const startKey = getNewsletterCutoffDateKey();
    const endKey = addDaysToDateKey(startKey, EVENT_WINDOW_DAYS);
    let outsideWindow = 0;
    let filtered = events.filter((e) => {
        const startDate = parseEventDate(e.start_date);
        if (!startDate) {
            reject(e, 'No start date');
            return false;
        }
        const key = getCentralDateKey(startDate);
        // Out-of-window events aren't logged as rejections: they're expected and would bury the useful ones.
        if (key < startKey || key > endKey) {
            outsideWindow++;
            return false;
        }
        return true;
    });
    log.info(`After date window (${startKey} to ${endKey}): ${filtered.length} events (${outsideWindow} outside window)`);

    // Pass 2: Known-virtual events
    filtered = filtered.filter((e) => {
        if (e.is_virtual === true) {
            reject(e, 'Online event');
            return false;
        }
        return true;
    });

    // Pass 3: Lu.ma enrichment so the checks below see full descriptions and locations
    const enriched: EventData[] = [];
    for (const event of filtered) {
        if (event.source === 'luma' || event.source === 'lu.ma' || (event.url && event.url.includes('lu.ma'))) {
            enriched.push((await enrichFromLuma(event)).event);
            continue;
        }
        enriched.push(event);
    }

    // Pass 4: Hard location checks. A known non-Texas state is rejected outright;
    // unknown states go to the classifier, which sees the full address.
    const located = enriched.filter((e) => {
        if (e.is_virtual === true) {
            reject(e, 'Online event');
            return false;
        }
        const state = e.state?.trim().toLowerCase();
        if (state && !TEXAS_STATE_VALUES.has(state)) {
            reject(e, `Not in Texas (${e.city ? `${e.city}, ` : ''}${e.state})`);
            return false;
        }
        if (!(e.venue_name || e.location || e.city)) {
            reject(e, 'No location listed');
            return false;
        }
        return true;
    });
    log.info(`After location checks: ${located.length} events`);

    // Pass 5: Dedup across Lu.ma and Meetup. Same day + similar title = same event.
    // Lu.ma is scraped first, so its listing wins.
    const kept: { event: EventData; day: string; tokens: Set<string> }[] = [];
    for (const event of located) {
        const day = getCentralDateKey(parseEventDate(event.start_date)!);
        const tokens = titleTokens(event.title);
        const dup = kept.find((k) => k.day === day && similarity(k.tokens, tokens) >= DUPLICATE_TITLE_SIMILARITY);
        if (dup) {
            reject(event, `Duplicate of "${dup.event.title}"`);
            continue;
        }
        kept.push({ event, day, tokens });
    }
    const deduped = kept.map((k) => k.event);
    log.info(`After dedup: ${deduped.length} events`);

    // Pass 6: Texas / in person / AI-focused, as three separate yes/no checks
    const passed = await selectByClassification(deduped, jev, reject);

    // Pass 7: Cap. Keep the most builder-relevant events, then list them by date.
    const startTime = (e: EventData) => parseEventDate(e.start_date)?.getTime() ?? 0;
    passed.sort((a, b) => b.fit - a.fit || startTime(a.event) - startTime(b.event));
    for (const extra of passed.splice(MAX_EVENTS)) {
        reject(extra.event, `Passed every check but over the ${MAX_EVENTS}-event cap (builder fit ${extra.fit}/5)`);
    }
    const selected = passed.map((p) => p.event).sort((a, b) => startTime(a) - startTime(b));

    // Pass 8: Summarize long descriptions for display
    for (const event of selected) {
        // Every description is rewritten, not just long ones: organizer copy is
        // written in their voice ("join us as we...") and reads as if we host it.
        if (event.description) {
            try {
                event.description = await claudeService.summarizeEventDescription(event.description);
            } catch (error) {
                log.warning(`Failed to summarize description for: ${event.title}, truncating instead`, {
                    error: String(error),
                });
                event.description = `${event.description.slice(0, MAX_DISPLAY_DESCRIPTION)}...`;
            }
        }
    }

    const formatted: FilteredEvent[] = selected.map((e) => ({
        title: cleanCopy(e.title),
        url: e.url,
        when: formatEventDateTime({
            start_date: e.start_date!,
            end_date: e.end_date,
            start_time: e.start_time,
            end_time: e.end_time,
            timezone: e.timezone,
        }),
        where: formatWhere(e),
        what: cleanCopy(e.description || e.title),
    }));

    log.info(`Step 6 complete: ${formatted.length} events kept, ${rejected.length} rejected.`);
    return { events: formatted, rejected };
}

async function selectByClassification(
    events: EventData[],
    jev: JevService,
    reject: (e: EventData, reason: string) => void,
): Promise<{ event: EventData; fit: number }[]> {
    if (events.length === 0) return [];

    let decisions;
    try {
        decisions = await jev.classifyEvents(events);
    } catch (error) {
        // Fail closed: listing unchecked events is worse than an empty section.
        log.error('Event classification failed; no events will be listed', { error: String(error) });
        for (const e of events) reject(e, `Not checked: classifier failed (${String(error).slice(0, 120)})`);
        return [];
    }

    return events.flatMap((event, i) => {
        const d = decisions[i];
        if (!d) {
            reject(event, 'Classifier returned no decision');
            return [];
        }
        const failed = [
            !d.is_in_texas && 'not in Texas',
            !d.is_in_person && 'not in person',
            !d.ai_is_main_topic && 'AI is not the main topic',
        ].filter(Boolean);
        if (failed.length > 0) {
            reject(event, `${failed.join('; ')}. ${d.reason}`);
            return [];
        }
        return [{ event, fit: d.builder_fit }];
    });
}

function titleTokens(title: string): Set<string> {
    const stop = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'in', 'at', 'on', 'with', 'to', 'x']);
    return new Set(
        title
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length > 1 && !stop.has(t)),
    );
}

function similarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    // Jaccard: "Austin AI Meetup" vs "Austin AI Meetup: Demos" = 0.75 (dup),
    // "Austin AI Meetup" vs "Austin AI Hackathon" = 0.5 (different events)
    return shared / (a.size + b.size - shared);
}

function formatWhere(event: EventData): string {
    const parts = [event.venue_name, event.city, event.state].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    return event.location || 'Location TBD';
}
