import log from '@apify/log';

import { parseEventDate } from './eventDate.js';

const DEFAULT_TIME_ZONE = 'America/Chicago';

export interface EventDateTimeParts {
    start_date: string;
    end_date?: string;
    start_time?: string;
    end_time?: string;
    timezone?: string;
}

/**
 * Format an event's date and time for the newsletter, always in the event's
 * timezone (default Central). Never format with the server's local timezone:
 * Apify containers run in UTC, so evening Central events would render as the
 * following day.
 */
export function formatEventDateTime(event: EventDateTimeParts): string {
    const tz = event.timezone || DEFAULT_TIME_ZONE;

    try {
        const startDate = parseEventDate(event.start_date);
        if (!startDate) {
            throw new Error(`Invalid date result from parsing "${event.start_date}"`);
        }

        const dayPart = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            weekday: 'long',
            month: 'long',
            day: 'numeric',
        }).format(startDate);

        let startTime: string | null = null;
        if (hasTimeComponent(event.start_date)) {
            startTime = formatInTimeZone(startDate, tz);
        } else if (event.start_time) {
            startTime = formatClockTime(event.start_time);
        }

        let endTime: string | null = null;
        if (hasTimeComponent(event.end_date)) {
            const endDate = parseEventDate(event.end_date);
            if (endDate) endTime = formatInTimeZone(endDate, tz);
        } else if (event.end_time) {
            endTime = formatClockTime(event.end_time);
        }

        if (!startTime) {
            return dayPart;
        }

        const tzAbbreviation = getTimeZoneAbbreviation(startDate, tz);
        return endTime
            ? `${dayPart} | ${startTime} - ${endTime} ${tzAbbreviation}`
            : `${dayPart} | ${startTime} ${tzAbbreviation}`;
    } catch (error) {
        log.warning(
            `Failed to format date "${event.start_date}" (startTime="${event.start_time}", endTime="${event.end_time}"), using raw value`,
            { error: String(error) },
        );
        const parts = [event.start_date, event.start_time, event.end_time].filter(Boolean);
        return parts.join(' | ');
    }
}

/** True when the value carries a real time of day (ISO datetime), not just a calendar date. */
function hasTimeComponent(value?: string): boolean {
    return !!value && /T\d{2}:\d{2}/.test(value);
}

function formatInTimeZone(date: Date, tz: string): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })
        .format(date)
        // Intl inserts a narrow no-break space (U+202F) before AM/PM in newer ICU versions
        .replace(/\u202f/g, ' ');
}

/** Format a bare "HH:mm" clock time (already in the event's timezone). */
function formatClockTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes || 0).padStart(2, '0')} ${period}`;
}

function getTimeZoneAbbreviation(date: Date, tz: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find((part) => part.type === 'timeZoneName')?.value || '';
}
