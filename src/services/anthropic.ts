import Anthropic from '@anthropic-ai/sdk';

import log from '@apify/log';

import { CONFIG } from '../config.js';
import { ArticleSummaryArraySchema } from '../schemas/articleSummary.js';
import { EventScoreArraySchema } from '../schemas/eventScore.js';
import { NewsletterMetadataSchema } from '../schemas/newsletterMeta.js';
import { RelevanceFilterArraySchema } from '../schemas/relevanceFilter.js';
import { StorySchema } from '../schemas/storyContent.js';
import type {
    ArticleData,
    ArticleSummary,
    CommunityHighlight,
    EventData,
    FilteredEvent,
    Initiative,
    NewsletterMetadata,
    RelevantArticle,
    Story,
} from '../types.js';
import { rateLimitDelay } from '../utils/rateLimiter.js';
import { removeEmDashes } from '../utils/textFormatting.js';

export class AnthropicService {
    private client: Anthropic;

    constructor() {
        this.client = new Anthropic({ apiKey: CONFIG.ANTHROPIC_API_KEY });
    }

    async evaluateRelevance(articles: ArticleData[]): Promise<RelevantArticle[]> {
        const articleList = articles
            .map(
                (a, i) =>
                    `${i + 1}. URL: ${a.url}\n   Headline: ${a.headline}\n   Description: ${a.description || 'N/A'}\n   Source: ${a.source_name || 'N/A'}`,
            )
            .join('\n\n');

        const response = await this.client.messages.create({
            model: CONFIG.CLAUDE_MODEL,
            max_tokens: 4000,
            messages: [
                {
                    role: 'user',
                    content: `You are a content curator for the AITX Community Weekly newsletter, focused on AI and technology news relevant to the Texas community.

Evaluate each article below for TWO criteria:
1. **AI Relevance**: Is this article about artificial intelligence, machine learning, data science, tech industry, or related technology topics?
2. **Texas Relevance**: Does this article have a connection to Texas (companies based in Texas, events in Texas, people from Texas, impact on Texas tech community)?

Also detect DUPLICATE coverage: different outlets often cover the same underlying story (same announcement, funding round, launch, or news event). When multiple articles cover the same underlying story, treat the strongest one (most complete, most authoritative) as the original and mark every other one as a duplicate of it.

Articles to evaluate:
${articleList}

Respond with a JSON array with one element per article, in the same order. Each element must have:
- "index": the article's number from the list above
- "is_ai_relevant": boolean
- "is_texas_relevant": boolean
- "relevance_score": number 0-100 (overall relevance to AITX newsletter)
- "duplicate_of": the number of the stronger article covering the same underlying story, or null if this article is not duplicate coverage
- "reasoning": brief explanation of your evaluation

Return ONLY the JSON array, no other text.`,
                },
            ],
        });

        this.logUsage('evaluateRelevance', response.usage);
        await rateLimitDelay();

        const text = this.extractText(response);
        const jsonArray = this.extractJsonArray(text);
        const parsed = RelevanceFilterArraySchema.parse(jsonArray);

        return parsed
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
                        relevance_score: result.relevance_score,
                        reasoning: removeEmDashes(result.reasoning),
                    },
                ];
            });
    }

    async generateSummaries(articles: ArticleData[]): Promise<ArticleSummary[]> {
        const articleList = articles
            .map(
                (a, i) =>
                    `${i + 1}. URL: ${a.url}\n   Headline: ${a.headline}\n   Description: ${a.description || 'N/A'}\n   Content excerpt: ${a.text_content ? a.text_content.slice(0, 500) : 'N/A'}`,
            )
            .join('\n\n');

        const response = await this.client.messages.create({
            model: CONFIG.CLAUDE_MODEL,
            max_tokens: 3000,
            messages: [
                {
                    role: 'user',
                    content: `You are a newsletter writer for the AITX Community Weekly.

Generate a 2-3 sentence summary for each article below. The summaries should be engaging, informative, and suitable for a professional newsletter audience interested in AI and technology in Texas.

Articles:
${articleList}

Respond with a JSON array with one element per article, in the same order. Each element must have:
- "index": the article's number from the list above
- "summary": 2-3 sentence engaging summary (50-500 characters)

Return ONLY the JSON array, no other text.`,
                },
            ],
        });

        this.logUsage('generateSummaries', response.usage);
        await rateLimitDelay();

        const text = this.extractText(response);
        const jsonArray = this.extractJsonArray(text);
        const parsed = ArticleSummaryArraySchema.parse(jsonArray);

        return parsed.flatMap((result) => {
            const original = articles[result.index - 1];
            if (!original) {
                log.warning(`generateSummaries returned unknown article index ${result.index}, skipping`);
                return [];
            }
            return [
                {
                    ...original,
                    summary: removeEmDashes(result.summary),
                },
            ];
        });
    }

    async generateStory(article: ArticleSummary): Promise<Story> {
        const response = await this.client.messages.create({
            model: CONFIG.CLAUDE_MODEL,
            max_tokens: 2000,
            messages: [
                {
                    role: 'user',
                    content: `You are a newsletter writer for the AITX Community Weekly.

Generate a full story section for this article:
- Headline: ${article.headline}
- URL: ${article.url}
- Summary: ${article.summary}
- Description: ${article.description || 'N/A'}
- Full text excerpt: ${article.text_content ? article.text_content.slice(0, 1000) : 'N/A'}

Respond with a JSON object containing:
- "headline": the article headline
- "url": the article URL
- "summary": 2-3 engaging sentences summarizing the article
- "why_it_matters": 1 sentence explaining why this matters to the AITX community
- "need_to_know": array of exactly 3 bullet points with specific facts, numbers, or key takeaways

Return ONLY the JSON object, no other text.`,
                },
            ],
        });

        this.logUsage('generateStory', response.usage);
        await rateLimitDelay();

        const text = this.extractText(response);
        const jsonObj = this.extractJsonObject(text);
        const parsed = StorySchema.parse(jsonObj);

        return {
            headline: removeEmDashes(parsed.headline),
            url: parsed.url,
            summary: removeEmDashes(parsed.summary),
            why_it_matters: removeEmDashes(parsed.why_it_matters),
            need_to_know: parsed.need_to_know.map((b) => removeEmDashes(b)),
        };
    }

    /**
     * Score each event's relevance 0-100. Returns scores aligned to the input
     * order (missing/invalid entries default to 0). Scoring instead of a
     * binary keep/reject lets the caller backfill from the next tier when the
     * strict tier yields too few events.
     */
    async scoreEventRelevance(events: EventData[]): Promise<number[]> {
        const eventList = events
            .map((e, i) => {
                const description = e.description ? e.description.slice(0, 1200) : 'N/A';
                return `${i + 1}. Title: ${e.title}\n   Description: ${description}\n   Location: ${e.venue_name || ''} ${e.city || ''} ${e.state || ''}`;
            })
            .join('\n\n');

        const response = await this.client.messages.create({
            model: CONFIG.CLAUDE_MODEL,
            max_tokens: 2000,
            messages: [
                {
                    role: 'user',
                    content: `You are a content curator for the AITX Community Weekly newsletter, which features in-person Texas events for the AI community.

Score each event below from 0 to 100 for how relevant it is to an audience of AI practitioners, builders, and enthusiasts:

- 80-100: AI, machine learning, generative AI, AI agents, data science, or AI engineering is the central topic (e.g. AI meetup, LLM workshop, ML paper club, AI hackathon).
- 50-79: AI-adjacent — a tech, robotics, developer, or data event where AI is a significant but not sole focus, or the community substantially overlaps with the AI community.
- 20-49: General technology, startup, or founder event where AI is incidental or only briefly mentioned.
- 0-19: Unrelated (wellness, HR, writing, purely social, or non-tech networking events; events where AI is absent).

Events:
${eventList}

Respond with a JSON array with one element per event, in the same order. Each element must have:
- "index": the event's number from the list above
- "score": number 0-100

Return ONLY the JSON array, no other text.`,
                },
            ],
        });

        this.logUsage('scoreEventRelevance', response.usage);
        await rateLimitDelay();

        const text = this.extractText(response);
        const jsonArray = this.extractJsonArray(text);
        const parsed = EventScoreArraySchema.parse(jsonArray);

        const scores = new Array<number>(events.length).fill(0);
        for (const result of parsed) {
            if (result.index >= 1 && result.index <= events.length) {
                scores[result.index - 1] = result.score;
            }
        }
        return scores;
    }

    async summarizeLumaDescription(descriptionContent: unknown): Promise<string> {
        const response = await this.client.messages.create({
            model: CONFIG.CLAUDE_HAIKU_MODEL,
            max_tokens: 200,
            messages: [
                {
                    role: 'user',
                    content: `Summarize the following event description (ProseMirror JSON format) into 1-2 clear sentences:

${JSON.stringify(descriptionContent)}

Return ONLY the summary text, no JSON formatting.`,
                },
            ],
        });

        this.logUsage('summarizeLumaDescription (Haiku)', response.usage);
        await rateLimitDelay();

        return removeEmDashes(this.extractText(response));
    }

    async synthesizeMetadata(data: {
        stories: Story[];
        communityHighlight?: CommunityHighlight;
        initiatives: Initiative[];
        events: FilteredEvent[];
    }): Promise<NewsletterMetadata> {
        const storySummary = data.stories.map((s) => `- ${s.headline}`).join('\n');
        const eventSummary = data.events.map((e) => `- ${e.title}`).join('\n');
        const highlightName = data.communityHighlight?.name || 'None';

        const response = await this.client.messages.create({
            model: CONFIG.CLAUDE_MODEL,
            max_tokens: 1500,
            messages: [
                {
                    role: 'user',
                    content: `You are writing metadata for the AITX Community Weekly newsletter.

Content this week:
Top Stories:
${storySummary}

Featured Community Member: ${highlightName}

Active Initiatives: ${data.initiatives.map((i) => i.title).join(', ') || 'None'}

Upcoming Events:
${eventSummary}

Generate the following metadata:
1. "title": Newsletter title starting with "AITX Community Weekly: " followed by an engaging teaser (under 100 total characters)
2. "subject_line": Compelling email subject line (under 60 characters, NO emojis)
3. "preview_text": Email preview pane text (80-120 characters)
4. "opening": 2-3 sentences setting context and teasing this week's content
5. "closing": 1-2 sentences with a call to action encouraging community engagement

Respond with ONLY a JSON object, no other text.`,
                },
            ],
        });

        this.logUsage('synthesizeMetadata', response.usage);
        await rateLimitDelay();

        const text = this.extractText(response);
        const jsonObj = this.extractJsonObject(text);
        const parsed = NewsletterMetadataSchema.parse(jsonObj);

        return {
            title: removeEmDashes(parsed.title),
            subject_line: removeEmDashes(parsed.subject_line),
            preview_text: removeEmDashes(parsed.preview_text),
            opening: removeEmDashes(parsed.opening),
            closing: removeEmDashes(parsed.closing),
        };
    }

    private extractText(response: Anthropic.Message): string {
        const block = response.content[0];
        if (block.type !== 'text') {
            throw new Error(`Expected text response, got ${block.type}`);
        }
        return block.text;
    }

    private extractJsonArray(text: string): unknown[] {
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
            throw new Error(`No JSON array found in response: ${text.slice(0, 200)}`);
        }
        return JSON.parse(match[0]) as unknown[];
    }

    private extractJsonObject(text: string): Record<string, unknown> {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error(`No JSON object found in response: ${text.slice(0, 200)}`);
        }
        return JSON.parse(match[0]) as Record<string, unknown>;
    }

    private logUsage(method: string, usage: Anthropic.Usage): void {
        log.info(`Claude API [${method}]: input_tokens=${usage.input_tokens}, output_tokens=${usage.output_tokens}`);
    }
}
