import Anthropic from '@anthropic-ai/sdk';

import log from '@apify/log';

import { CONFIG } from '../config.js';
import { ArticleSummaryArraySchema } from '../schemas/articleSummary.js';
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

For each article, provide a JSON response.

Articles to evaluate:
${articleList}

Respond with a JSON array. Each element must have:
- "url": the article URL
- "headline": the article headline
- "is_ai_relevant": boolean
- "is_texas_relevant": boolean
- "relevance_score": number 0-100 (overall relevance to AITX newsletter)
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

        return parsed.map((result) => {
            const original = articles.find((a) => a.url === result.url);
            return {
                ...original!,
                is_ai_relevant: result.is_ai_relevant,
                is_texas_relevant: result.is_texas_relevant,
                relevance_score: result.relevance_score,
                reasoning: removeEmDashes(result.reasoning),
            };
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

Respond with a JSON array. Each element must have:
- "url": the article URL
- "headline": the article headline
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

        return parsed.map((result) => {
            const original = articles.find((a) => a.url === result.url);
            return {
                ...original!,
                summary: removeEmDashes(result.summary),
            };
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

    async filterEventRelevance(events: EventData[]): Promise<EventData[]> {
        const eventList = events
            .map(
                (e, i) =>
                    `${i + 1}. Title: ${e.title}\n   Description: ${e.description || 'N/A'}\n   Location: ${e.venue_name || ''} ${e.city || ''} ${e.state || ''}`,
            )
            .join('\n\n');

        const response = await this.client.messages.create({
            model: CONFIG.CLAUDE_MODEL,
            max_tokens: 2000,
            messages: [
                {
                    role: 'user',
                    content: `You are a content curator for the AITX Community Weekly newsletter.

Filter the following events to keep ONLY those relevant to AI, technology, data science, machine learning, software engineering, or the broader tech community.

Events:
${eventList}

Respond with a JSON array of the event numbers to keep. For example: [1, 3]

Return ONLY the JSON array, no other text.`,
                },
            ],
        });

        this.logUsage('filterEventRelevance', response.usage);
        await rateLimitDelay();

        const text = this.extractText(response);
        const jsonArray = this.extractJsonArray(text);
        const indexes = jsonArray
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= events.length);
        const keep = new Set(indexes.map((value) => value - 1));

        return events.filter((_, index) => keep.has(index)).slice(0, 8);
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
