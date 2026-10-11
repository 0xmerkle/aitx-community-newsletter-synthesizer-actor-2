import { z } from 'zod';

export const EventClassificationSchema = z.object({
    index: z.number().int().min(1),
    is_in_texas: z.boolean(),
    is_in_person: z.boolean(),
    ai_is_main_topic: z.boolean(),
    builder_fit: z.number().int().min(1).max(5),
    reason: z.string(),
});

export const EventClassificationArraySchema = z.array(EventClassificationSchema);

export type EventClassificationResult = z.infer<typeof EventClassificationSchema>;
