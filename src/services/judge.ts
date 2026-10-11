import type { EventClassificationResult } from '../schemas/eventClassification.js';
import type { ArticleData, EventData, RelevantArticle } from '../types.js';

/** Makes the keep/drop decisions for stories and events. Implemented by Claude and by Jev. */
export interface Judge {
    evaluateRelevance(articles: ArticleData[], issueDate: string): Promise<RelevantArticle[]>;
    classifyEvents(events: EventData[]): Promise<(EventClassificationResult | undefined)[]>;
}
