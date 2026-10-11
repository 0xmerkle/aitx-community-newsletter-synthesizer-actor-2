/** Jev's decision for one event. Kept only when all three checks pass. */
export interface EventClassificationResult {
    index: number;
    is_in_texas: boolean;
    is_in_person: boolean;
    ai_is_main_topic: boolean;
    /** 1-5, builders and hands-on events highest */
    builder_fit: number;
    reason: string;
}
