const CENTRAL_TIME_ZONE = 'America/Chicago';

export function parseEventDate(value?: string): Date | null {
    if (!value) return null;

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
        const [, year, month, day] = dateOnly;
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
    }

    return null;
}

export function getCentralDateKey(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: CENTRAL_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
        throw new Error(`Could not derive Central date key for ${date.toISOString()}`);
    }

    return `${year}-${month}-${day}`;
}

export function getNewsletterCutoffDateKey(now = new Date()): string {
    const centralDay = new Intl.DateTimeFormat('en-US', {
        timeZone: CENTRAL_TIME_ZONE,
        weekday: 'short',
    }).format(now);

    if (centralDay === 'Fri') return getCentralDateKey(now);

    const daysUntilFriday = (5 - getCentralDayIndex(now) + 7) % 7 || 7;
    const nextFriday = new Date(now);
    nextFriday.setUTCDate(nextFriday.getUTCDate() + daysUntilFriday);
    return getCentralDateKey(nextFriday);
}

function getCentralDayIndex(date: Date): number {
    const day = new Intl.DateTimeFormat('en-US', {
        timeZone: CENTRAL_TIME_ZONE,
        weekday: 'short',
    }).format(date);

    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
}
