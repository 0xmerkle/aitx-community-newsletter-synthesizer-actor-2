import { z } from 'zod';

export const RelevanceFilterSchema = z.object({
    url: z.string(),
    headline: z.string(),
    is_ai_relevant: z.boolean(),
    is_texas_relevant: z.boolean(),
    relevance_score: z.number().min(0).max(100),
    reasoning: z.string(),
});

export const RelevanceFilterArraySchema = z.array(RelevanceFilterSchema);

export type RelevanceFilterResult = z.infer<typeof RelevanceFilterSchema>;
