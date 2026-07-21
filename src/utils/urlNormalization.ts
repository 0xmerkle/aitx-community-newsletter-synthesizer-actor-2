export function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);

        // Remove common tracking parameters
        const trackingParams = [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_content',
            'utm_term',
            'ref',
            'source',
        ];
        trackingParams.forEach((param) => parsed.searchParams.delete(param));

        // Normalize: lowercase hostname, remove trailing slash, sort params
        parsed.hostname = parsed.hostname.toLowerCase();
        parsed.searchParams.sort();

        let normalized = parsed.toString();
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }

        return normalized;
    } catch {
        // If URL parsing fails, just return trimmed lowercase
        return url.trim().toLowerCase();
    }
}
