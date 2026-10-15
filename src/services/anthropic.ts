import Anthropic from '@anthropic-ai/sdk';
import { ZodError } from 'zod';

import log from '@apify/log';

import { CONFIG } from '../config.js';
import { AITX_CONTEXT, AITX_LINKS, HOUSE_STYLE, NAMING_RULE, TITLE_PREFIX, VOICE } from '../context.js';
import { ArticleSummaryArraySchema } from '../schemas/articleSummary.js';
import { METADATA_LIMITS, NewsletterMetadataSchema } from '../schemas/newsletterMeta.js';
import { StorySchema } from '../schemas/storyContent.js';
import type {
    ArticleData,
    ArticleSummary,
    FilteredEvent,
    NewsletterMetadata,
    Story,
} from '../types.js';
import { rateLimitDelay } from '../utils/rateLimiter.js';
import { cleanCopy } from '../utils/textFormatting.js';

// How much article body text each step sees
const SUMMARY_EXCERPT_CHARS = 1500;
const STORY_EXCERPT_CHARS = 4000;

type JsonSchema = Record<string, unknown>;

interface StructuredCall<T> {
    method: string;
    model: string;
    effort: 'low' | 'medium' | 'high';
    maxTokens: number;
    prompt: string;
    schema: JsonSchema;
    parse: (input: unknown) => T;
}

// Keywords structured outputs doesn't enforce; zod validates them after parsing instead.
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']);

/** Adapt a schema for structured outputs: closed objects, nullable unions as anyOf, no unenforced limits. */
function toStructuredSchema(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(toStructuredSchema);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
        if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) continue;
        out[key] = toStructuredSchema(value);
    }
    if (Array.isArray(out.type)) {
        const { type, description, ...rest } = out;
        return {
            ...(description ? { description } : {}),
            anyOf: (type as string[]).map((t) => ({ ...rest, type: t })),
        };
    }
    if (out.type === 'object') out.additionalProperties = false;
    return out;
}

export class AnthropicService {
    private client: Anthropic;

    constructor() {
        this.client = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });
    }

    async generateSummaries(articles: ArticleData[]): Promise<ArticleSummary[]> {
        const articleList = articles
            .map(
                (a, i) =>
                    `${i + 1}. Headline: ${a.headline}\n   Description: ${a.description || 'N/A'}\n   Text excerpt: ${a.text_content ? a.text_content.slice(0, SUMMARY_EXCERPT_CHARS) : 'N/A'}`,
            )
            .join('\n\n');

        const results = await this.callStructured({
            method: 'generateSummaries',
            model: CONFIG.CLAUDE_MODEL,
            effort: 'medium',
            maxTokens: 16000,
            schema: {
                type: 'object',
                properties: {
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                index: { type: 'integer' },
                                summary: { type: 'string', description: '2 sentences, 50-400 characters' },
                            },
                            required: ['index', 'summary'],
                        },
                    },
                },
                required: ['results'],
            },
            prompt: `You write for the AITX Community Weekly newsletter.

${AITX_CONTEXT}

${HOUSE_STYLE}

Write a 2 sentence summary of each article. Use only facts stated in the excerpt.

Articles:
${articleList}`,
            parse: (input) => ArticleSummaryArraySchema.parse((input as { results: unknown }).results),
        });

        return results.flatMap((result) => {
            const original = articles[result.index - 1];
            if (!original) {
                log.warning(`generateSummaries returned unknown article index ${result.index}, skipping`);
                return [];
            }
            return [{ ...original, summary: cleanCopy(result.summary) }];
        });
    }

    async generateStory(article: ArticleSummary): Promise<Story> {
        const parsed = await this.callStructured({
            method: 'generateStory',
            model: CONFIG.CLAUDE_MODEL,
            effort: 'medium',
            maxTokens: 16000,
            schema: {
                type: 'object',
                properties: {
                    headline: { type: 'string', description: 'Short, plain headline, under 80 characters' },
                    url: { type: 'string' },
                    summary: { type: 'string', description: '2 sentences' },
                    why_it_matters: { type: 'string', description: '1 sentence, tied to Texas AI builders' },
                    need_to_know: {
                        type: 'array',
                        items: { type: 'string' },
                        minItems: 3,
                        maxItems: 3,
                        description: '3 bullets with specific facts or numbers from the text',
                    },
                },
                required: ['headline', 'url', 'summary', 'why_it_matters', 'need_to_know'],
            },
            prompt: `You write for the AITX Community Weekly newsletter.

${AITX_CONTEXT}

${HOUSE_STYLE}

Write the story section for this article. Every fact, name, and number must come from the text below. If the text doesn't support three specific bullets, keep the bullets short, never invent.
${article.texas_connection ? `\nTexas connection: ${article.texas_connection}` : ''}
Headline: ${article.headline}
URL: ${article.url}
Summary: ${article.summary}
Text: ${article.text_content ? article.text_content.slice(0, STORY_EXCERPT_CHARS) : article.description || 'N/A'}`,
            parse: (input) => StorySchema.parse(input),
        });

        return {
            headline: cleanCopy(parsed.headline),
            url: article.url,
            summary: cleanCopy(parsed.summary),
            why_it_matters: cleanCopy(parsed.why_it_matters),
            need_to_know: parsed.need_to_know.map((b) => cleanCopy(b)),
        };
    }

    async summarizeEventDescription(description: unknown): Promise<string> {
        const text = typeof description === 'string' ? description : JSON.stringify(description);

        const { summary } = await this.callStructured({
            method: 'summarizeEventDescription',
            model: CONFIG.CLAUDE_HAIKU_MODEL,
            effort: 'low',
            maxTokens: 4000,
            schema: {
                type: 'object',
                properties: { summary: { type: 'string' } },
                required: ['summary'],
            },
            prompt: `Summarize this event description in 1-2 plain sentences (under 40 words) for a newsletter event listing. Say what attendees will do or learn.

Use only facts stated in the description. This event is run by another organization: do not mention AITX Community, and do not say who the attendees are or who hosts it unless the description says so.

${HOUSE_STYLE}

Event description:
${text.slice(0, 4000)}`,
            parse: (input) => input as { summary: string },
        });

        return cleanCopy(summary);
    }

    async synthesizeMetadata(
        data: {
            stories: Story[];
            events: FilteredEvent[];
        },
        issueDate: string,
    ): Promise<NewsletterMetadata> {
        const storySummary = data.stories.map((s) => `- ${s.headline}`).join('\n') || 'None';
        const eventSummary = data.events.map((e) => `- ${e.title}`).join('\n') || 'None';

        const basePrompt = `You write the header for the AITX Community Weekly newsletter issue dated ${issueDate}.

${AITX_CONTEXT}

${HOUSE_STYLE}
${NAMING_RULE}

${VOICE}

${AITX_LINKS}

This week:
Top stories:
${storySummary}

Upcoming events (run by other organizations: never call them AITX events, and don't comment on who runs them; just call them events or Texas AI events):
${eventSummary}

Write:
- title: the issue headline. Lead with the single most interesting item. At most ${METADATA_LIMITS.title} characters. Don't add "AITX Community Weekly:", we prepend it.
- subject_line: at most ${METADATA_LIMITS.subject_line} characters. Specific, not clickbait. Sentence case.
- preview_text: one short line that complements the subject line, at most ${METADATA_LIMITS.preview_text} characters.
- opening: 1-2 sentences, under 35 words, that tell readers what's in this issue.
- closing: 1 sentence with one clear call to action. If it points somewhere, use one of the links above, written out in full. Never invent facts, names, or links.

Only mention seasons, holidays, or the time of year if they are accurate for ${issueDate}. Shorter is better everywhere.`;

        const schema: JsonSchema = {
            type: 'object',
            properties: {
                title: { type: 'string', maxLength: METADATA_LIMITS.title },
                subject_line: { type: 'string', maxLength: METADATA_LIMITS.subject_line },
                preview_text: { type: 'string', maxLength: METADATA_LIMITS.preview_text },
                opening: { type: 'string' },
                closing: { type: 'string' },
            },
            required: ['title', 'subject_line', 'preview_text', 'opening', 'closing'],
        };

        // Clean before validating so stripped emojis/dashes count toward the limits.
        const clean = (input: unknown) => {
            const raw = input as Record<string, unknown>;
            return NewsletterMetadataSchema.parse(
                Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? cleanCopy(v) : v])),
            );
        };

        let feedback = '';
        for (let attempt = 1; ; attempt++) {
            try {
                const metadata = await this.callStructured({
                    method: `synthesizeMetadata (attempt ${attempt})`,
                    model: CONFIG.CLAUDE_MODEL,
                    effort: 'medium',
                    maxTokens: 16000,
                    schema,
                    prompt: basePrompt + feedback,
                    parse: clean,
                });
                return { ...metadata, title: `${TITLE_PREFIX}${metadata.title.replace(/^AITX Community Weekly:\s*/i, '')}` };
            } catch (error) {
                if (!(error instanceof ZodError) || attempt >= 2) throw error;
                const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
                log.warning(`Metadata failed validation, retrying: ${issues}`);
                feedback = `\n\nYour previous answer broke these limits: ${issues}. Make every field shorter.`;
            }
        }
    }

    /** Constrain the response to a JSON schema (structured outputs), then validate it with zod. */
    private async callStructured<T>(call: StructuredCall<T>): Promise<T> {
        const response = await this.client.messages.create({
            model: call.model,
            max_tokens: call.maxTokens,
            output_config: {
                effort: call.effort,
                format: { type: 'json_schema', schema: toStructuredSchema(call.schema) as JsonSchema },
            },
            messages: [{ role: 'user', content: call.prompt }],
        });

        this.logUsage(call.method, response.usage);
        await rateLimitDelay();

        if (response.stop_reason === 'max_tokens') {
            throw new Error(`${call.method}: response hit max_tokens (${call.maxTokens}); output was truncated`);
        }
        if (response.stop_reason === 'refusal') {
            throw new Error(`${call.method}: model declined the request`);
        }

        return call.parse(JSON.parse(this.extractText(response)));
    }

    private extractText(response: Anthropic.Message): string {
        const block = response.content.find((b) => b.type === 'text');
        if (!block || block.type !== 'text') {
            throw new Error('Expected a text response');
        }
        return block.text;
    }

    private logUsage(method: string, usage: Anthropic.Usage): void {
        log.info(`Claude API [${method}]: input_tokens=${usage.input_tokens}, output_tokens=${usage.output_tokens}`);
    }
}
