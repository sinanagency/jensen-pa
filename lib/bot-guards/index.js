// @sinanagency/bot-guards — public API.
//
// Three pure modules. Each REQUIRES a BotGuardsConfig. The package itself
// holds zero bot-specific knowledge. Contamination is structurally impossible.
//
// Read DOCS.md (or src/config.ts) for the contamination contract.
export { sanitizeReply } from "./pre-send.js";
export { classifyIntent } from "./classifier.js";
export { resolvePendingAction } from "./pending-resolver.js";
//# sourceMappingURL=index.js.map