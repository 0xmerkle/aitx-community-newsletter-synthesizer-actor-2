import { z } from 'zod';

// Hard limits. The old 80-250 char preview text was the "giant subtitle" in Notion/Beehiiv.
export const METADATA_LIMITS = {
    title: 60,
    subject_line: 50,
    preview_text: 90,
} as const;

export const NewsletterMetadataSchema = z.object({
    title: z.string().min(1).max(METADATA_LIMITS.title),
    subject_line: z.string().min(1).max(METADATA_LIMITS.subject_line),
    preview_text: z.string().min(1).max(METADATA_LIMITS.preview_text),
    opening: z.string().min(1),
    closing: z.string().min(1),
});

export type NewsletterMetadataResult = z.infer<typeof NewsletterMetadataSchema>;
