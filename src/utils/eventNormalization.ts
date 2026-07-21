import type { EventData } from '../types.js';

function resolveVirtual(rawItem: Record<string, unknown>): boolean | undefined {
    if (rawItem.is_virtual !== undefined) return Boolean(rawItem.is_virtual);
    if (rawItem.isVirtual !== undefined) return Boolean(rawItem.isVirtual);
    if (rawItem.isOnline !== undefined) return Boolean(rawItem.isOnline);
    return undefined;
}

export function normalizeEvent(rawItem: Record<string, unknown>): EventData {
    return {
        type: 'event',
        source: (rawItem.source as string) || undefined,
        title: (rawItem.title as string) || (rawItem.name as string) || '',
        url: (rawItem.url as string) || (rawItem.link as string) || undefined,
        luma_event_api_id:
            (rawItem.luma_event_api_id as string) ||
            (rawItem.lumaEventApiId as string) ||
            (rawItem.event_api_id as string) ||
            undefined,
        start_date:
            (rawItem.start_date as string) ||
            (rawItem.eventDate as string) ||
            (rawItem.date as string) ||
            (rawItem.startDate as string) ||
            (rawItem.startDateTime as string) ||
            undefined,
        end_date:
            (rawItem.end_date as string) ||
            (rawItem.endDate as string) ||
            (rawItem.endDateTime as string) ||
            undefined,
        start_time:
            (rawItem.start_time as string) ||
            (rawItem.eventTime as string) ||
            (rawItem.time as string) ||
            (rawItem.startTime as string) ||
            undefined,
        end_time: (rawItem.end_time as string) || (rawItem.endTime as string) || undefined,
        timezone: (rawItem.timezone as string) || undefined,
        location: (rawItem.location as string) || (rawItem.full_address as string) || undefined,
        venue_name:
            (rawItem.venue_name as string) || (rawItem.venue as string) || (rawItem.venueName as string) || undefined,
        city: (rawItem.city as string) || undefined,
        state: (rawItem.state as string) || (rawItem.region as string) || undefined,
        description: (rawItem.description as string) || undefined,
        is_virtual: resolveVirtual(rawItem),
    };
}
