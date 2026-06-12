import type { BotGuardsConfig, PreSendResult } from "./config.js";
/**
 * Run the pre-send filters. Pure function — no I/O.
 *
 * @param body  the outbound body the bot is about to send
 * @param config the bot's own BotGuardsConfig
 * @returns     { body, caught } — body is what should actually be sent,
 *              caught is non-null if a filter dropped the original
 */
export declare function sanitizeReply(body: string, config: BotGuardsConfig): PreSendResult;
//# sourceMappingURL=pre-send.d.ts.map