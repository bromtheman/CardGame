// Every tunable of the model-backed PracticeAI in one place (2026-09-16 LLM
// PracticeAI spec §8) — the gameSettings.ts rule: nothing below is inlined at
// a use site. The ops knobs (model id, kill switch, API key) are env vars read
// by makePolicy.ts; DEFAULT_BOT_MODEL is the one default that lives here.
export const DEFAULT_BOT_MODEL = 'inception/mercury-2.5'
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const LLM_CALL_TIMEOUT_MS = 4_000        // per call, via AbortController
export const LLM_REQUEST_BUDGET_MS = 8_000      // total model time per request
export const LLM_MAX_CALLS_PER_REQUEST = 4      // one plan + reactions
export const LLM_MAX_PLAN_LENGTH = 12           // menu ids per answer; the schema's maxItems
export const LLM_MAX_OUTPUT_TOKENS = 600
export const LLM_TEMPERATURE = 0.7
export const EXPECTATION_MAX_CHARS = 400
export const MENU_MAX_TRIALS = 400              // clone-and-apply verifications per menu (CPU bound)
export const MENU_MAX_ITEMS = 80                // items shown to the model (prompt bound)
export const MENU_LOG_LINES_PER_ITEM = 4        // engine log lines quoted per menu item
export const TABLE_TALK_MAX_CHARS = 140
export const LOG_TAIL_LINES = 15                // public log lines quoted in the prompt
