import log from '@apify/log';

import { CONFIG } from '../config.js';
import type { EventClassificationResult } from '../schemas/eventClassification.js';
import type { ArticleData, EventData, RelevantArticle } from '../types.js';

// TypeSafe Jev via OpenRouter's decisions endpoint (not chat/completions).
// Jev answers typed questions about a "state": noul = probability of yes,
// score = position on an ordered rubric. Docs: https://docs.typesafe.ai/api
const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
const MODEL = '~typesafe/jev-latest';

// A noul at or above this counts as "yes". Articles use a lower bar because
// the relevance score ranks them and its floor drops weak ones; events have no such backstop.
const EVENT_YES_THRESHOLD = 0.7;
const ARTICLE_AI_THRESHOLD = 0.5;
// Stricter: national stories with a thin Texas angle (stock forecasts, macro takes) land around 0.5-0.65
const ARTICLE_TEXAS_THRESHOLD = 0.7;
const CONCURRENCY = 8;
const MAX_ATTEMPTS = 3;
const ARTICLE_EXCERPT_CHARS = 1500;

type Question =
    | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
    | { type: 'score'; instructions: string; criteria: string[] }
    | { type: 'choice'; instructions: string; criteria: Record<string, string | null> };

interface NoulAnswer {
    type: 'noul';
    noul: number;
}
interface ScoreAnswer {
    type: 'score';
    score: number;
}
interface ChoiceAnswer {
    type: 'choice';
    choice: string;
    probabilities: Record<string, number>;
}
type Answers = Record<string, NoulAnswer | ScoreAnswer | ChoiceAnswer>;

// A duplicate match must be at least this likely before we drop a story
const DUPLICATE_THRESHOLD = 0.6;

// Rules (Michael, 2026-10-11):
// Events: in person AND in Texas AND AI-related. Rank builders, engineers and
// entrepreneurs first; AI for marketing, sales, etc. is still relevant but lower.
// Stories: about Texas AND about AI, where AI includes political news, company
// news, innovations, research, controversy, etc.

const EVENT_QUESTIONS: Record<string, Question> = {
    in_texas: { type: 'noul', instructions: 'The event venue is in Texas.' },
    in_person: {
        type: 'noul',
        instructions: 'People meet physically at a venue.',
        criteria: { true: 'In person, or hybrid with a real venue', false: 'Online-only or livestream-only' },
    },
    ai_related: {
        type: 'noul',
        instructions: 'The event is about AI: AI is a real subject of the event, not just a word in the title.',
        criteria: {
            true: 'AI meetups, workshops, hackathons, technical talks, AI founder events, and AI for a business function such as marketing, sales, finance, or operations',
            false: 'AI is absent or only a buzzword, e.g. general networking, wellness, real estate, crypto, social events, or a tech event with no AI content',
        },
    },
    builder_fit: {
        type: 'score',
        instructions: 'How useful this event is to people who build with AI: engineers, builders, and entrepreneurs.',
        criteria: [
            'Not about AI',
            'AI for a business function (marketing, sales, finance, HR, operations), or a vendor-hosted sales or executive dinner',
            'General AI talks, panels, or networking',
            'For builders and founders: technical talks, demos, founder events',
            'Hands-on building: workshops, hackathons, build nights',
        ],
    },
};

const ARTICLE_QUESTIONS: Record<string, Question> = {
    about_ai: {
        type: 'noul',
        instructions: 'The article is about AI.',
        criteria: {
            true: 'AI political news, AI company news, AI innovations and launches, AI research, AI controversy, AI policy and courts, or infrastructure built for AI (chips, data centers, power)',
            false: 'General tech, crypto, gadgets, or a story where AI is only a passing mention',
        },
    },
    about_texas: {
        type: 'noul',
        instructions: 'The article is relevant to Texas: it states a concrete Texas connection.',
        criteria: {
            true: 'A company based or with a major operation in Texas, something happening in a Texas city, Texas politics, law or government, or a Texas university',
            false: 'A national or global story that only might affect Texas',
        },
    },
    relevance: {
        type: 'score',
        instructions: 'How newsworthy this is for people in the Texas AI community.',
        criteria: [
            'Not relevant',
            'Marginal: AI barely discussed, listicle, or little content',
            'Some interest: commentary or minor news',
            'Solid Texas AI news',
            'Major Texas AI news: big launch, funding, deal, facility, research result, law, ruling, or controversy',
        ],
    },
};

/** Makes every keep/drop decision for stories and events. Claude only writes copy. */
export class JevService {
    constructor() {
        if (!CONFIG.OPENROUTER_API_KEY) {
            throw new Error('OPENROUTER_API_KEY is required (TypeSafe Jev via OpenRouter)');
        }
    }

    async classifyEvents(events: EventData[]): Promise<(EventClassificationResult | undefined)[]> {
        const answers = await mapLimit(events, CONCURRENCY, async (e) =>
            this.decide(
                {
                    title: e.title,
                    host: e.host_name,
                    where: [e.venue_name, e.location, e.city, e.state].filter(Boolean).join(' | ') || 'unknown',
                    location_type: e.location_type ?? (e.is_virtual === false ? 'in person' : 'unknown'),
                    description: e.description?.slice(0, 1500),
                },
                EVENT_QUESTIONS,
            ),
        );

        return answers.map((a, i) => {
            if (!a) return undefined;
            const texas = noul(a, 'in_texas');
            const person = noul(a, 'in_person');
            const ai = noul(a, 'ai_related');
            return {
                index: i + 1,
                is_in_texas: texas >= EVENT_YES_THRESHOLD,
                is_in_person: person >= EVENT_YES_THRESHOLD,
                ai_is_main_topic: ai >= EVENT_YES_THRESHOLD,
                // Rubric levels 0-4 map to 1-5
                builder_fit: Math.round(score(a, 'builder_fit')) + 1,
                reason: `Jev: in Texas ${texas.toFixed(2)}, in person ${person.toFixed(2)}, AI-related ${ai.toFixed(2)}`,
            };
        });
    }

    async evaluateRelevance(articles: ArticleData[]): Promise<RelevantArticle[]> {
        const answers = await mapLimit(articles, CONCURRENCY, async (a) =>
            this.decide(
                {
                    headline: a.headline,
                    source: a.source_name,
                    published: a.published_date ?? 'unknown',
                    description: a.description,
                    text_excerpt: a.text_content?.slice(0, ARTICLE_EXCERPT_CHARS),
                },
                ARTICLE_QUESTIONS,
            ),
        );

        const judged: RelevantArticle[] = articles.flatMap((article, i) => {
            const a = answers[i];
            if (!a) return [];
            const ai = noul(a, 'about_ai');
            const texas = noul(a, 'about_texas');
            return [
                {
                    ...article,
                    is_ai_relevant: ai >= ARTICLE_AI_THRESHOLD,
                    is_texas_relevant: texas >= ARTICLE_TEXAS_THRESHOLD,
                    // Rubric levels 0-4 map to 0-100
                    relevance_score: Math.round((score(a, 'relevance') / 4) * 100),
                    reasoning: `Jev: AI subject ${ai.toFixed(2)}, Texas link ${texas.toFixed(2)}`,
                },
            ];
        });

        const eligible = judged.filter((a) => a.is_ai_relevant && a.is_texas_relevant);
        const duplicates = await this.findDuplicateStories(eligible);
        return judged.filter((a) => !duplicates.has(a.url));
    }

    /**
     * Different outlets often cover the same story. One request: every article is
     * in the state, and for each one Jev picks which earlier article (if any)
     * covers the same story. Of each matched pair, the lower-relevance one is dropped.
     */
    private async findDuplicateStories(articles: RelevantArticle[]): Promise<Set<string>> {
        const dupes = new Set<string>();
        if (articles.length < 2) return dupes;

        const id = (i: number) => `a${i + 1}`;
        const questions: Record<string, Question> = {};
        for (let i = 1; i < articles.length; i++) {
            const criteria: Record<string, string | null> = { none: 'No earlier article covers the same story' };
            for (let j = 0; j < i; j++) criteria[id(j)] = articles[j].headline;
            questions[id(i)] = {
                type: 'choice',
                instructions: `Which earlier article covers the same underlying story (same announcement, deal, launch, ruling, or event) as article \`${id(i)}\`? Articles about different stories are not the same, even if they share a company or topic.`,
                criteria,
            };
        }

        const answers = await this.decide(
            {
                articles: Object.fromEntries(
                    articles.map((a, i) => [id(i), { headline: a.headline, source: a.source_name, summary: a.description?.slice(0, 400) }]),
                ),
            },
            questions,
        );
        if (!answers) {
            log.warning('Jev duplicate check failed; keeping all stories');
            return dupes;
        }

        for (let i = 1; i < articles.length; i++) {
            const a = answers[id(i)];
            if (a?.type !== 'choice' || a.choice === 'none' || (a.probabilities[a.choice] ?? 0) < DUPLICATE_THRESHOLD) continue;
            const j = Number(a.choice.slice(1)) - 1;
            const [weaker, stronger] =
                articles[i].relevance_score <= articles[j].relevance_score ? [articles[i], articles[j]] : [articles[j], articles[i]];
            log.info(`Dropping duplicate story "${weaker.headline}" (same story as "${stronger.headline}")`);
            dupes.add(weaker.url);
        }
        return dupes;
    }

    private async decide(state: Record<string, unknown>, questions: Record<string, Question>): Promise<Answers | undefined> {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(DECISIONS_URL, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ model: MODEL, state, questions }),
                });
                if (response.status === 429 || response.status >= 500) {
                    throw new Error(`OpenRouter ${response.status}`);
                }
                const body = (await response.json()) as { answers?: Answers; error?: { message: string } };
                if (!response.ok || !body.answers) {
                    // 4xx other than 429: retrying won't help
                    log.warning(`Jev request rejected: ${body.error?.message ?? response.status}`);
                    return undefined;
                }
                return body.answers;
            } catch (error) {
                if (attempt === MAX_ATTEMPTS) {
                    log.warning(`Jev request failed after ${MAX_ATTEMPTS} attempts`, { error: String(error) });
                    return undefined;
                }
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 1000 * attempt);
                });
            }
        }
        return undefined;
    }
}

function noul(answers: Answers, key: string): number {
    const a = answers[key];
    return a?.type === 'noul' ? a.noul : 0;
}

function score(answers: Answers, key: string): number {
    const a = answers[key];
    return a?.type === 'score' ? a.score : 0;
}

/** Map with at most `limit` promises in flight, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
