import { z } from 'zod';

export const StorySchema = z.object({
    headline: z.string(),
    url: z.string(),
    summary: z.string(),
    why_it_matters: z.string(),
    need_to_know: z.array(z.string()).length(3),
});

export type StoryResult = z.infer<typeof StorySchema>;
