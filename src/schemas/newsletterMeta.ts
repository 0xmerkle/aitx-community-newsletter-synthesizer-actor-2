import { z } from 'zod';

export const NewsletterMetadataSchema = z.object({
    title: z.string().max(100),
    subject_line: z.string().max(60),
    preview_text: z.string().min(80).max(250),
    opening: z.string(),
    closing: z.string(),
});

export type NewsletterMetadataResult = z.infer<typeof NewsletterMetadataSchema>;
