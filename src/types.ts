export interface ActorInput {
    datasetId: string;
    topStoriesCount?: number;
    webhookUrl?: string;
}

export interface ArticleData {
    type: 'article';
    url: string;
    headline: string;
    description?: string;
    published_date?: string;
    source_name?: string;
    text_content?: string;
}

export interface EventData {
    type: 'event';
    source?: string;
    title: string;
    url?: string;
    start_date?: string;
    end_date?: string;
    start_time?: string;
    end_time?: string;
    location?: string;
    venue_name?: string;
    city?: string;
    state?: string;
    description?: string;
    is_virtual?: boolean;
}

export interface RelevantArticle extends ArticleData {
    is_ai_relevant: boolean;
    is_texas_relevant: boolean;
    relevance_score: number;
    reasoning: string;
}

export interface ArticleSummary extends ArticleData {
    summary: string;
}

export interface Story {
    headline: string;
    url: string;
    summary: string;
    why_it_matters: string;
    need_to_know: string[];
}

export interface FilteredEvent {
    title: string;
    url?: string;
    when: string;
    where: string;
    what: string;
}

export interface CommunityHighlight {
    id: string;
    name: string;
    bio: string;
    achievement?: string;
    linkedin_url?: string;
}

export interface Initiative {
    id: string;
    title: string;
    description: string;
    start_date?: string;
    end_date?: string;
    contact?: string;
    url?: string;
}

export interface NewsletterMetadata {
    title: string;
    subject_line: string;
    preview_text: string;
    opening: string;
    closing: string;
}

export interface NewsletterDraft {
    metadata: NewsletterMetadata;
    stories: Story[];
    communityHighlight?: CommunityHighlight;
    initiatives: Initiative[];
    events: FilteredEvent[];
    generatedAt: string;
    articlesCount: number;
    eventsCount: number;
}

export interface PipelineState {
    step: number;
    stepName: string;
    input: ActorInput;
    createdAt: string;
    lastUpdated: string;
    rawData?: { articles: ArticleData[]; events: EventData[] };
    relevantArticles?: RelevantArticle[];
    summaries?: ArticleSummary[];
    topStories?: Story[];
    notionData?: { highlights: CommunityHighlight[]; initiatives: Initiative[] };
    filteredEvents?: FilteredEvent[];
    metadata?: NewsletterMetadata;
    notionPageUrl?: string;
}
