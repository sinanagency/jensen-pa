// Pre-send deterministic checker. Pure function. No I/O, no side effects.
//
// Two filters, in order:
//   1. forbiddenBrands — catches cross-bot brand leaks (Sasa-emit in CTH bot,
//      Jensen-emit in Sasa, etc.). This is THE contamination wall.
//   2. bannedPatterns — catches bot-specific banned text (canned lines,
//      em-dashes, style violations).
//
// On match, body is replaced with config.reaskPhrase. Caller is responsible
// for emitting the P0 alert (this module returns the result; the alert is
// I/O, which lives in the bot's worker code).
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Run the pre-send filters. Pure function — no I/O.
 *
 * @param body  the outbound body the bot is about to send
 * @param config the bot's own BotGuardsConfig
 * @returns     { body, caught } — body is what should actually be sent,
 *              caught is non-null if a filter dropped the original
 */
export function sanitizeReply(body, config) {
    if (!body)
        return { body, caught: null };
    // 1) Forbidden brands FIRST — contamination wall. Word-boundary, case-insensitive.
    for (const brand of config.forbiddenBrands) {
        if (!brand)
            continue;
        const pat = new RegExp("\\b" + escapeRegex(brand) + "\\b", "i");
        if (pat.test(body)) {
            return {
                body: config.reaskPhrase,
                caught: { kind: "forbidden_brand", pattern: brand, original: body.slice(0, 800) },
            };
        }
    }
    // 2) Banned patterns — per-bot style/content rules.
    for (const pat of config.bannedPatterns) {
        if (pat.test(body)) {
            return {
                body: config.reaskPhrase,
                caught: { kind: "banned_pattern", pattern: pat.source.slice(0, 200), original: body.slice(0, 800) },
            };
        }
    }
    return { body, caught: null };
}
//# sourceMappingURL=pre-send.js.map