import log from '@apify/log';

import type { EventData } from '../types.js';

interface LumaEventResponse {
    event?: {
        start_at?: string;
        end_at?: string;
        timezone?: string;
        geo_address_info?: {
            address?: string;
            full_address?: string;
            city?: string;
            region?: string;
        };
        location_type?: string;
        description_mirror?: {
            content?: unknown;
        };
    };
}

export function extractSlugFromUrl(url: string): string | null {
    try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || null;
    } catch {
        return null;
    }
}

export async function enrichFromLuma(event: EventData): Promise<{ event: EventData; descriptionContent?: unknown }> {
    if (!event.url) return { event };

    const slug = extractSlugFromUrl(event.url);
    if (!slug) return { event };

    try {
        const response = await fetch(`https://api.lu.ma/event/get?event_api_id=${slug}`);
        if (!response.ok) {
            log.warning(`Lu.ma API returned ${response.status} for slug: ${slug}`);
            return { event };
        }

        const data = (await response.json()) as LumaEventResponse;
        const lumaEvent = data.event;
        if (!lumaEvent) return { event };

        const enriched = { ...event };
        let descriptionContent: unknown;

        if (lumaEvent.start_at) {
            const tz = lumaEvent.timezone || 'America/Chicago';
            const startDate = new Date(lumaEvent.start_at);
            enriched.start_date = enriched.start_date || formatDatePart(startDate, tz);
            enriched.start_time = enriched.start_time || formatTimePart(startDate, tz);
        }

        if (lumaEvent.end_at) {
            const tz = lumaEvent.timezone || 'America/Chicago';
            const endDate = new Date(lumaEvent.end_at);
            enriched.end_time = enriched.end_time || formatTimePart(endDate, tz);
        }

        if (lumaEvent.geo_address_info) {
            const geo = lumaEvent.geo_address_info;
            enriched.venue_name = enriched.venue_name || geo.address || undefined;
            enriched.location = enriched.location || geo.full_address || undefined;
            enriched.city = enriched.city || geo.city || undefined;
            enriched.state = enriched.state || geo.region || undefined;
        }

        if (lumaEvent.location_type === 'online') {
            enriched.is_virtual = true;
        }

        if (lumaEvent.description_mirror?.content) {
            descriptionContent = lumaEvent.description_mirror.content;
        }

        return { event: enriched, descriptionContent };
    } catch (error) {
        log.warning(`Failed to enrich from Lu.ma for event: ${event.title}`, { error: String(error) });
        return { event };
    }
}

function formatDatePart(date: Date, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(date);
}

function formatTimePart(date: Date, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    return formatter.format(date);
}
