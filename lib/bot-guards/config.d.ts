export interface BotGuardsConfig {
    /** Display name of THIS bot (used in logs only, never in user output). */
    readonly botName: string;
    /**
     * Regexes that, if matched in an outbound reply, cause the pre-send
     * checker to DROP that reply and replace it with reaskPhrase. Includes:
     *   - Banned canned strings (e.g. Sasa's HONEST_NO_ACTION literal)
     *   - Bot-specific style violations (e.g. CTH's em-dash ban)
     *   - Per-bot policy patterns (no profanity, no urgency manipulation, etc.)
     */
    readonly bannedPatterns: readonly RegExp[];
    /**
     * Brand names that must NEVER appear in this bot's output. Usually
     * other bots' names + Sasa-Stephen-4Q style historical leaks. The
     * pre-send checker scans for these explicitly and fires a brand_leak
     * P0 event when matched.
     */
    readonly forbiddenBrands: readonly string[];
    /**
     * The valid intent labels for this bot. The classifier returns one of
     * these. Adding a new intent: extend this list AND add a handler in
     * the bot's worker code. The lib does no routing — it returns a typed
     * intent name and lets the bot decide.
     */
    readonly intentEnum: readonly string[];
    /**
     * The pending_action kinds this bot uses. The conversational resolver
     * checks for awaiting_collect rows of these kinds. Bot-specific.
     */
    readonly pendingKinds: readonly string[];
    /**
     * The neutral short re-ask emitted when:
     *   - Pre-send drops a banned reply
     *   - Resolver returns "no match, but a question was asked"
     * Each bot has its own voice for this. Sasa: "Tell me a bit more...",
     * CTH: "Can you share a bit more so I can help?", Jensen: "Tell me more
     * so I can handle it."
     */
    readonly reaskPhrase: string;
    /**
     * Anthropic API key for the Haiku classifier. Each bot has its own.
     * Supplied at call time, never persisted in the lib.
     */
    readonly anthropicApiKey: string;
    /**
     * Classifier model id (defaults to Haiku 4.5). Override if a bot wants
     * to A/B a different model.
     */
    readonly classifierModel?: string;
}
export type Confidence = "high" | "medium" | "low";
export interface ClassifyResult<I extends string = string> {
    intent: I;
    confidence: Confidence;
    reason: string;
    error?: string;
}
export interface PreSendResult {
    /** The body that should actually be sent to the user. */
    body: string;
    /** Whether the original body was dropped due to a banned-pattern match. */
    caught: {
        kind: "banned_pattern" | "forbidden_brand";
        pattern: string;
        original: string;
    } | null;
}
//# sourceMappingURL=config.d.ts.map