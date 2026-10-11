import Anthropic from '@anthropic-ai/sdk';
import { ZodError } from 'zod';

import log from '@apify/log';

import { CONFIG } from '../config.js';
import { AITX_CONTEXT, AITX_LINKS, HOUSE_STYLE, NAMING_RULE, TITLE_PREFIX, VOICE } from '../context.js';
import { ArticleSummaryArraySchema } from '../schemas/articleSummary.js';
import { EventClassificationArraySchema, type EventClassificationResult } from '../schemas/eventClassification.js';
import { METADATA_LIMITS, NewsletterMetadataSchema } from '../schemas/newsletterMeta.js';
import { RelevanceFilterArraySchema } from '../schemas/relevanceFilter.js';
import { StorySchema } from '../schemas/storyContent.js';
import type {
    ArticleData,
    ArticleSummary,
    EventData,
    FilteredEvent,
    NewsletterMetadata,
    RelevantArticle,
    Story,
} from '../types.js';
import { rateLimitDelay } from '../utils/rateLimiter.js';
import { cleanCopy } from '../utils/textFormatting.js';

// How much article body text each step sees
const RELEVANCE_EXCERPT_CHARS = 1500;
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

    async evaluateRelevance(articles: ArticleData[], issueDate: string): Promise<RelevantArticle[]> {
        const articleList = articles
            .map(
                (a, i) =>
                    `${i + 1}. Headline: ${a.headline}\n   Source: ${a.source_name || 'N/A'}\n   Published: ${a.published_date || 'unknown'}\n   Description: ${a.description || 'N/A'}\n   Text excerpt: ${a.text_content ? a.text_content.slice(0, RELEVANCE_EXCERPT_CHARS) : 'N/A'}`,
            )
            .join('\n\n');

        const results = await this.callStructured({
            method: 'evaluateRelevance',
            model: CONFIG.CLAUDE_HAIKU_MODEL,
            effort: 'low',
            maxTokens: 16000,
            schema: {
                type: 'object',
                properties: {
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                index: { type: 'integer', description: "The article's number from the list" },
                                is_ai_relevant: {
                                    type: 'boolean',
                                    description: 'True only if AI/ML is the main subject of the story',
                                },
                                is_texas_relevant: {
                                    type: 'boolean',
                                    description: 'True only if there is a concrete Texas connection stated in the article',
                                },
                                texas_connection: {
                                    type: ['string', 'null'],
                                    description: 'The specific Texas connection in a few words, or null',
                                },
                                relevance_score: { type: 'integer', minimum: 0, maximum: 100 },
                                duplicate_of: {
                                    type: ['integer', 'null'],
                                    description: 'Number of the stronger article covering the same story, or null',
                                },
                                reasoning: { type: 'string', description: 'One short sentence' },
                            },
                            required: [
                                'index',
                                'is_ai_relevant',
                                'is_texas_relevant',
                                'texas_connection',
                                'relevance_score',
                                'duplicate_of',
                                'reasoning',
                            ],
                        },
                    },
                },
                required: ['results'],
            },
            prompt: `You pick stories for the AITX Community Weekly newsletter issue dated ${issueDate}.

${AITX_CONTEXT}

Judge each article on two separate questions. Be strict: a story we skip costs nothing, a bad story costs reader trust.

1. is_ai_relevant: The article is about AI. That includes AI political news, AI company news, innovations and launches, research, controversy, policy and courts, and infrastructure built for AI (chips, data centers, power). General tech, crypto, gadgets, or stories where AI is a passing mention: false.
2. is_texas_relevant: The article itself states a concrete Texas connection: a company headquartered or with a major operation in Texas, something happening in a Texas city, Texas legislation or government, or a Texas university. A national story that might affect Texas: false. Name the connection in texas_connection.

relevance_score (0-100): how much an AI builder in Texas would want to read it. Favor concrete news (launches, funding, deals, hires, facilities, research, court rulings, laws, and AI in Texas politics and campaigns) over opinion pieces, listicles, and stories with little content.

Duplicates: if several articles cover the same underlying story, keep the most complete one and set duplicate_of on the others to its number.

Articles:
${articleList}`,
            parse: (input) => RelevanceFilterArraySchema.parse((input as { results: unknown }).results),
        });

        return results
            .filter((result) => {
                if (result.duplicate_of !== null && result.duplicate_of !== result.index) {
                    log.info(`Dropping duplicate story #${result.index} (same story as #${result.duplicate_of}): ${articles[result.index - 1]?.headline}`);
                    return false;
                }
                return true;
            })
            .flatMap((result) => {
                const original = articles[result.index - 1];
                if (!original) {
                    log.warning(`evaluateRelevance returned unknown article index ${result.index}, skipping`);
                    return [];
                }
                return [
                    {
                        ...original,
                        is_ai_relevant: result.is_ai_relevant,
                        is_texas_relevant: result.is_texas_relevant,
                        texas_connection: result.texas_connection ?? undefined,
                        relevance_score: result.relevance_score,
                        reasoning: cleanCopy(result.reasoning),
                    },
                ];
            });
    }

    /** URLs of articles that repeat a story another article in the list covers better. */
    async findDuplicateStories(articles: ArticleData[], issueDate: string): Promise<Set<string>> {
        if (articles.length < 2) return new Set();

        const articleList = articles
            .map((a, i) => `${i + 1}. ${a.headline} (${a.source_name || 'unknown source'})\n   ${a.description || ''}`)
            .join('\n\n');

        const results = await this.callStructured({
            method: 'findDuplicateStories',
            model: CONFIG.CLAUDE_HAIKU_MODEL,
            effort: 'low',
            maxTokens: 8000,
            schema: {
                type: 'object',
                properties: {
                    duplicates: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                index: { type: 'integer', description: 'The weaker article' },
                                duplicate_of: { type: 'integer', description: 'The stronger article covering the same story' },
                            },
                            required: ['index', 'duplicate_of'],
                        },
                    },
                },
                required: ['duplicates'],
            },
            prompt: `These articles were picked for the AITX Community Weekly newsletter issue dated ${issueDate}. Different outlets often cover the same underlying story (same announcement, deal, launch, ruling, or event). For each group covering the same story, keep the most complete article and list every other one as a duplicate of it. Articles about different stories are not duplicates, even if they share a company or topic. Return an empty list if there are none.

Articles:
${articleList}`,
            parse: (input) => (input as { duplicates: { index: number; duplicate_of: number }[] }).duplicates,
        });

        const dupes = new Set<string>();
        for (const d of results) {
            const article = articles[d.index - 1];
            if (article && d.index !== d.duplicate_of) {
                log.info(`Dropping duplicate story #${d.index} (same story as #${d.duplicate_of}): ${article.headline}`);
                dupes.add(article.url);
            }
        }
        return dupes;
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

    /**
     * Three separate yes/no decisions per event instead of one blended score.
     * An event is only kept when all three are true.
     */
    async classifyEvents(events: EventData[]): Promise<(EventClassificationResult | undefined)[]> {
        const eventList = events
            .map((e, i) => {
                const description = e.description ? e.description.slice(0, 1200) : 'N/A';
                const categories = e.categories && e.categories.length > 0 ? e.categories.join(', ') : 'N/A';
                const where = [e.venue_name, e.location, e.city, e.state].filter(Boolean).join(' | ') || 'unknown';
                return `${i + 1}. Title: ${e.title}\n   Host: ${e.host_name || 'N/A'}\n   Where: ${where}\n   Platform location type: ${e.location_type || (e.is_virtual === false ? 'in person' : 'unknown')}\n   Platform tags (set by the host, weak signal): ${categories}\n   Description: ${description}`;
            })
            .join('\n\n');

        const results = await this.callStructured({
            method: 'classifyEvents',
            model: CONFIG.CLAUDE_HAIKU_MODEL,
            effort: 'low',
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
                                is_in_texas: { type: 'boolean' },
                                is_in_person: { type: 'boolean' },
                                ai_is_main_topic: { type: 'boolean' },
                                builder_fit: {
                                    type: 'integer',
                                    description: '1-5: 5 = hands-on building (workshop, hackathon, build night); 4 = for builders and founders (technical talk, demos, founder event); 3 = general AI talks, panels, networking; 2 = AI for marketing, sales, finance, or operations; 1 = barely about AI',
                                },
                                reason: { type: 'string', description: 'One short sentence explaining any false answer' },
                            },
                            required: ['index', 'is_in_texas', 'is_in_person', 'ai_is_main_topic', 'builder_fit', 'reason'],
                        },
                    },
                },
                required: ['results'],
            },
            prompt: `You pick community events for the AITX Community Weekly newsletter.

${AITX_CONTEXT}

Answer three yes/no questions for each event. Be strict: listing a bad event costs more than skipping a good one.

1. is_in_texas: The venue is in Texas.
2. is_in_person: People meet physically. Online-only and livestream-only events: false. Hybrid with a real venue: true.
3. ai_is_main_topic: The event is AI-related: AI is a real subject (AI meetups, workshops, hackathons, technical talks, AI founder events, and AI for marketing, sales, finance, or operations). False when AI is absent or just a buzzword: general networking, wellness, real estate, crypto, social events, or tech events with no AI content. Hosts often tag events "AI" for reach, so judge the title and description, not the tag.

builder_fit ranks AI-related events: builders, engineers, and entrepreneurs first; AI for business functions like marketing and sales is still relevant but ranks lower.

Events:
${eventList}`,
            parse: (input) => EventClassificationArraySchema.parse((input as { results: unknown }).results),
        });

        const byIndex = new Array<EventClassificationResult | undefined>(events.length);
        for (const result of results) {
            if (result.index >= 1 && result.index <= events.length) {
                byIndex[result.index - 1] = result;
            }
        }
        return byIndex;
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

Upcoming events:
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
