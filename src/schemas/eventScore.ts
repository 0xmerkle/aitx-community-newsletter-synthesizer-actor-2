import { z } from 'zod';

export const EventScoreSchema = z.object({
    index: z.number().int().min(1),
    score: z.number().min(0).max(100),
});

export const EventScoreArraySchema = z.array(EventScoreSchema);

export type EventScoreResult = z.infer<typeof EventScoreSchema>;
