import { format, parse } from 'date-fns';

import log from '@apify/log';

export function formatEventDateTime(date: string, startTime?: string, endTime?: string): string {
    try {
        const parsedDate = parse(date, 'yyyy-MM-dd', new Date());
        if (Number.isNaN(parsedDate.getTime())) {
            throw new Error(`Invalid date result from parsing "${date}"`);
        }
        const dayOfWeek = format(parsedDate, 'EEEE');
        const monthDay = format(parsedDate, 'MMMM d');

        let timeStr = '';
        if (startTime) {
            const formattedStart = formatTime(startTime);
            if (endTime) {
                const formattedEnd = formatTime(endTime);
                timeStr = ` | ${formattedStart} - ${formattedEnd} CST`;
            } else {
                timeStr = ` | ${formattedStart} CST`;
            }
        }

        return `${dayOfWeek}, ${monthDay}${timeStr}`;
    } catch (error) {
        log.warning(`Failed to format date "${date}" (startTime="${startTime}", endTime="${endTime}"), using raw value`, {
            error: String(error),
        });
        const parts = [date, startTime, endTime].filter(Boolean);
        return parts.join(' | ');
    }
}

function formatTime(time: string): string {
    // Handle HH:mm format
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return minutes === 0
        ? `${displayHours}:00 ${period}`
        : `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
}
