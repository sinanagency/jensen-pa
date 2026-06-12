// BotGuardsConfig — the contamination contract.
//
// Every public function in this package REQUIRES a BotGuardsConfig. The
// package itself ships ZERO bot-specific knowledge: no persona text, no
// banned phrases, no intent names, no table names, no brand terms.
// Each bot supplies its own config object. The package is pure machinery.
//
// Cross-contamination is structurally impossible because:
//   1. The package has no global state and no bundled facts
//   2. Every operation receives the config at call time
//   3. forbiddenBrands enforce that one bot's brand never appears in another's output
//   4. TypeScript prevents accidentally crossing configs across bots
//
// Adding new behavior to the lib: ALWAYS take a config parameter, NEVER
// hardcode a value that a different bot would need differently.
export {};
//# sourceMappingURL=config.js.map