// Every tunable of the model-backed PracticeAI in one place (2026-09-16 LLM
// PracticeAI spec §8) — the gameSettings.ts rule: nothing below is inlined at
// a use site. The ops knobs (model id, kill switch, API key) are env vars read
// by makePolicy.ts; DEFAULT_BOT_MODEL is the one default that lives here.
export const DEFAULT_BOT_MODEL = 'inception/mercury-2.5'
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
// OpenRouter's unified `reasoning.effort` — one field for every provider
// (docs/use-cases/reasoning-tokens). It is sent only when the model's row
// below or BOT_REASONING_EFFORT names a level, so the request Mercury was
// evaluated with is unchanged: Mercury reasons on its own (the catalog's
// `default_enabled: true`). DeepSeek V4.1 Flash reasons by default too and
// accepts low|high|max (`default_effort: high`); the field pins the level
// rather than leaving it to whichever provider serves the call. Effort does
// not shorten its thinking — on one turn-1 prompt it ran 580–4 500 tokens at
// `low` and `high` alike (2026-09-17 probe) — so `high` is the row and the
// timeouts below absorb the spread. `none` switches reasoning off where the
// model allows it.
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
export const MODEL_REASONING_EFFORT: Readonly<Record<string, ReasoningEffort>> = {
  'deepseek/deepseek-v4.1-flash': 'high',
}
// OpenRouter's `provider` routing object (docs/features/provider-routing).
// One model id is spread over many providers (twenty for DeepSeek V4.1
// Flash) that differ in speed by 3×: at StreamLake's 48 tok/s a
// 1 400-token think is the whole 30 s cap, and the 2026-09-17 evals timed
// out 10–11 of 12 calls under both default routing and a StreamLake pin.
// `sort: 'throughput'` routes each call to the provider OpenRouter currently
// measures as fastest (Modal at 105–177 tok/s in the probe), and
// `require_parameters` skips providers that do not claim structured
// outputs — Alibaba answered with prose instead of the schema's JSON.
// BOT_PROVIDERS adds an `only` pin on top of the row (or alone, for a model
// without one); slugs come from GET /api/v1/models/<id>/endpoints.
export interface OpenRouterRouting {
  sort?: 'throughput' | 'latency' | 'price'
  only?: readonly string[]
  require_parameters?: boolean
}
export const MODEL_ROUTING: Readonly<Record<string, OpenRouterRouting>> = {
  'deepseek/deepseek-v4.1-flash': { sort: 'throughput', require_parameters: true },
}
// The caps are for a long think or a slow provider moment, and the owner
// would rather wait than hand the turn to the heuristic (2026-09-17). The
// frontend's "PracticeAI is thinking…" label covers the wait. DeepSeek V4.1
// Flash measured 6–38 s per call on the fastest route (the think length
// varies 8× on one prompt), so the call cap is 60 s; a Mercury call is ~2 s.
// The budget admits another call only while the time already spent is under
// it, so one request is bounded by budget + one call ≈ 120 s, inside the
// runtime's 150 s wall clock — raising the budget to 120 s would let a
// request run to 180 s and take the human's own action down with it.
// LLM_MAX_CALLS_PER_REQUEST still bounds the count.
export const LLM_CALL_TIMEOUT_MS = 60_000       // per call, via AbortController
export const LLM_REQUEST_BUDGET_MS = 60_000     // model time already spent that still admits a call
export const LLM_MAX_CALLS_PER_REQUEST = 4      // one plan + reactions
export const LLM_MAX_PLAN_LENGTH = 12           // menu ids per answer; the schema's maxItems
// Mercury 2.5 REASONS before it answers, and the reasoning is spent inside
// max_tokens: at 600 it ran out mid-thought and every answer came back empty
// or garbled (2026-09-17 eval — 100% `http` fallbacks). 65 536 is the
// provider's max_completion_tokens; a typical turn uses ~1k of it (~$0.00015,
// ~2 s), and the owner wants the reasoning kept for stronger play and better
// table-talk. A value above the provider's ceiling risks a 400 → silent
// heuristic, so this is the ceiling itself, not the 260k context.
export const LLM_MAX_OUTPUT_TOKENS = 65_536
export const LLM_TEMPERATURE = 0.7
export const EXPECTATION_MAX_CHARS = 400
export const MENU_MAX_TRIALS = 400              // clone-and-apply verifications per menu (CPU bound)
export const MENU_MAX_ITEMS = 80                // items shown to the model (prompt bound)
export const MENU_LOG_LINES_PER_ITEM = 4        // engine log lines quoted per menu item
export const TABLE_TALK_MAX_CHARS = 140
export const LOG_TAIL_LINES = 15                // public log lines quoted in the prompt
