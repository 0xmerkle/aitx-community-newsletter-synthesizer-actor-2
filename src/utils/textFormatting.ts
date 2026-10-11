export function removeEmDashes(text: string): string {
    // Em dashes become commas (house style); en dashes are usually ranges ("6-8 PM").
    return text.replace(/\s*—\s*/g, ', ').replace(/–/g, '-');
}

/**
 * Organizers sometimes stuff notes or markdown into titles, e.g.
 * "Python Essentials for Vibe Coders![Must register at Eventbrite](...)".
 * Cut at the first markdown image/link and clean the rest.
 */
export function cleanEventTitle(title: string): string {
    return cleanCopy(title.split(/!?\[/)[0]).replace(/[\s|:-]+$/, '');
}

/** Enforce house style on model output: no em dashes, no bold markers, no emojis. */
export function cleanCopy(text: string): string {
    return removeEmDashes(text)
        .replace(/\*\*/g, '')
        .replace(/[\p{Extended_Pictographic}️]/gu, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}
