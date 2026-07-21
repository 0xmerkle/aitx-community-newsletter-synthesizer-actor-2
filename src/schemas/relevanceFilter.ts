import { z } from 'zod';

export const RelevanceFilterSchema = z.object({
    index: z.number().int().min(1),
    is_ai_relevant: z.boolean(),
    is_texas_relevant: z.boolean(),
    relevance_score: z.number().min(0).max(100),
    duplicate_of: z.number().int().min(1).nullable(),
    reasoning: z.string(),
});

export const RelevanceFilterArraySchema = z.array(RelevanceFilterSchema);

export type RelevanceFilterResult = z.infer<typeof RelevanceFilterSchema>;
