import { z } from 'zod';

export const ArticleSummarySchema = z.object({
    url: z.string(),
    headline: z.string().optional(),
    summary: z.string().min(50).max(500),
});

export const ArticleSummaryArraySchema = z.array(ArticleSummarySchema);

export type ArticleSummaryResult = z.infer<typeof ArticleSummarySchema>;
