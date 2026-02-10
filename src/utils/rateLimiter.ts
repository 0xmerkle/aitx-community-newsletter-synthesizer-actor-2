import { CONFIG } from '../config.js';

export async function rateLimitDelay(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY_MS);
    });
}
