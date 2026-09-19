import type { GameAction } from '../../engine/engineTypes.ts'
import type { BotPolicy, OwedKind } from '../basicPolicy.ts'
import type { BotView } from '../botView.ts'
import { EMPTY_USAGE, LlmHttpError, LlmTimeoutError } from './llmClient.ts'
import type { LlmClient, LlmUsage } from './llmClient.ts'
import {
  LLM_CALL_TIMEOUT_MS, LLM_MAX_CALLS_PER_REQUEST, LLM_MAX_OUTPUT_TOKENS, LLM_REQUEST_BUDGET_MS, LLM_TEMPERATURE,
} from './llmSettings.ts'
import type { OpenRouterRouting, ReasoningEffort } from './llmSettings.ts'
import { sameAction } from './moveMenu.ts'
import type { MenuItem } from './moveMenu.ts'
import { parsePlanAnswer, PLAN_SCHEMA } from './planSchema.ts'
import { buildSystemPrompt, buildUserPrompt } from './prompt.ts'
import type { FallbackReason, TelemetryRow } from './telemetry.ts'

// reasoningEffort and routing ride on every call of the request;
// makePolicy.ts picks them per model and env, and absent means the model's
// own default / OpenRouter's default routing.
export interface LlmPolicySettings {
  callTimeoutMs: number
  requestBudgetMs: number
  maxCalls: number
  reasoningEffort?: ReasoningEffort
  routing?: OpenRouterRouting
  // Sectioned flow only: moves the model may name per answer. Defaults to
  // ACTIONS_PER_ANSWER; a test sets 2 to exercise the plan path.
  actionsPerAnswer?: number
}
export const DEFAULT_LLM_POLICY_SETTINGS: LlmPolicySettings = {
  callTimeoutMs: LLM_CALL_TIMEOUT_MS, requestBudgetMs: LLM_REQUEST_BUDGET_MS, maxCalls: LLM_MAX_CALLS_PER_REQUEST,
}

// The model-backed policy (spec §3.3). One instance per request: it holds
// the plan the model gave, a cursor over it, the line it wants to say, and
// the telemetry rows the function writes after the commit.
//
// The model only ever suggests. Every planned move is re-verified against
// the CURRENT menu before it is offered (the menu is the legality oracle, so
// this policy never touches an EngineGame), the fallback's candidates trail
// every answer (the evaluator in production — makePolicy.ts — so a tripped
// or disabled policy still plays by score, not at random), and any failure —
// timeout, HTTP, malformed, budget — trips the policy for the rest of the
// request so failures cannot stack timeouts on the human's click.
export class LlmPolicy implements BotPolicy {
  readonly rows: TelemetryRow[] = []
  private readonly client: LlmClient | null
  private readonly fallback: BotPolicy
  private readonly model: string
  readonly settings: LlmPolicySettings
  private readonly now: () => number
  private plan: MenuItem[] = []
  private planKind: OwedKind | null = null
  private planned = false            // has the model been asked at all this request
  private appliedItems: MenuItem[] = []
  private pendingTalk: string | null = null
  private tripped: FallbackReason | null = null
  private currentRow: TelemetryRow | null = null
  private calls = 0
  private spentMs = 0

  constructor(
    client: LlmClient | null,
    fallback: BotPolicy,
    model: string,
    settings: LlmPolicySettings = DEFAULT_LLM_POLICY_SETTINGS,
    now: () => number = Date.now,
  ) {
    this.client = client
    this.fallback = fallback
    this.model = model
    this.settings = settings
    this.now = now
    if (client === null) this.tripped = 'disabled'
  }

  // Always: the scored fallback reads the menu, so a tripped or disabled
  // policy still needs one built (2026-09-19 scored menu spec §6.4).
  get needsMenu(): boolean { return true }

  get modelId(): string { return this.model }

  async candidates(view: BotView, kind: OwedKind): Promise<GameAction[]> {
    if (this.tripped) {
      if (this.tripped === 'disabled' && this.rows.length === 0) this.rows.push(this.row(view, kind, 0, 0, 'disabled'))
      return this.fallback.candidates(view, kind)
    }
    const menu = view.menu ?? []
    // A report nobody can approve yields an empty decision menu (reject is
    // not enumerated — moveMenu.ts's enumerateDecision); the driver's
    // fallback handles it. No call, no row.
    if (menu.length === 0) return this.fallback.candidates(view, kind)
    const next = this.plan[0]
    if (next && this.planKind === kind && menu.some((m) => sameAction(m.action, next.action))) {
      return [next.action, ...(await this.fallback.candidates(view, kind))]
    }
    const situation = this.situationFor(kind, next)
    this.plan = []
    if (this.calls >= this.settings.maxCalls || this.spentMs >= this.settings.requestBudgetMs) {
      this.tripped = 'budget'
      this.rows.push(this.row(view, kind, menu.length, 0, 'budget'))
      return this.fallback.candidates(view, kind)
    }
    const items = await this.ask(view, kind, menu, situation)
    if (items === null) return this.fallback.candidates(view, kind)
    this.plan = items
    this.planKind = kind
    return [items[0].action, ...(await this.fallback.candidates(view, kind))]
  }

  onAccepted(action: GameAction, _kind: OwedKind): string | null {
    const next = this.plan[0]
    if (next && sameAction(next.action, action)) {
      this.plan.shift()
      this.appliedItems.push(next)
      this.currentRow?.applied.push(action)
      const talk = this.pendingTalk
      this.pendingTalk = null
      return talk
    }
    // The engine took something else — a heuristic tail candidate or the
    // driver's fallback. A verified move was refused: file it, drop the plan.
    if (next && this.currentRow && this.currentRow.fallbackReason === null) this.currentRow.fallbackReason = 'plan_rejected'
    this.plan = []
    this.pendingTalk = null
    return null
  }

  private situationFor(kind: OwedKind, next: MenuItem | undefined): string | null {
    if (!this.planned) return null
    if (next && this.planKind === kind) return `Your planned move #${next.id} (${next.text}) is no longer available — the board changed. Choose again from the new menu.`
    if (next) return `The board changed before your plan finished: you now owe a ${kind} decision.`
    if (this.planKind === kind && kind === 'turn') return 'Your plan is complete and it is still your turn — usually the answer is to end it.'
    return `Your previous plan finished; you now owe a ${kind} decision.`
  }

  // One model call. Returns the plan as menu items, or null after filing the
  // failure and tripping. Latency is measured on the policy's clock so the
  // budget and the row agree.
  private async ask(view: BotView, kind: OwedKind, menu: MenuItem[], situation: string | null): Promise<MenuItem[] | null> {
    const started = this.now()
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.settings.callTimeoutMs)
    this.calls++
    this.planned = true
    let text: string | null = null
    let usage: LlmUsage = EMPTY_USAGE
    let reason: FallbackReason | null = null
    let detail: string | null = null
    try {
      const res = await this.client!.complete({
        messages: [
          { role: 'system', content: buildSystemPrompt(view.state.factions[view.side]) },
          { role: 'user', content: buildUserPrompt({ view, kind, menu, situation, planSoFar: this.appliedItems }) },
        ],
        schemaName: 'plan',
        schema: PLAN_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: LLM_MAX_OUTPUT_TOKENS,
        temperature: LLM_TEMPERATURE,
        reasoningEffort: this.settings.reasoningEffort,
        routing: this.settings.routing,
      }, ac.signal)
      text = res.text
      usage = res.usage
    } catch (e) {
      reason = ac.signal.aborted || e instanceof LlmTimeoutError ? 'timeout' : 'http'
      detail = (e instanceof LlmHttpError ? `HTTP ${e.status}: ${e.message}` : e instanceof Error ? e.message : String(e)).slice(0, 160)
    } finally {
      clearTimeout(timer)
    }
    const latencyMs = Math.max(0, this.now() - started)
    this.spentMs += latencyMs
    const answer = reason === null && text !== null ? parsePlanAnswer(text) : null
    const items = answer ? answer.plan.map((id) => menu.find((m) => m.id === id)).filter((m): m is MenuItem => m !== undefined) : []
    if (reason === null && items.length === 0) {
      reason = 'malformed'
      detail = `unparseable answer: ${(text ?? '').slice(0, 160)}`
    }
    const row = this.row(view, kind, menu.length, latencyMs, reason, usage, detail)
    if (answer && reason === null) {
      row.plan = items.map((m) => ({ id: m.id, text: m.text, action: m.action }))
      row.expectation = answer.expectation
      row.tableTalk = answer.tableTalk
    }
    this.rows.push(row)
    if (reason !== null) {
      this.tripped = reason
      return null
    }
    this.currentRow = row
    this.pendingTalk = answer!.tableTalk
    return items
  }

  private row(
    view: BotView, kind: OwedKind, menuSize: number, latencyMs: number, reason: FallbackReason | null,
    usage: LlmUsage = EMPTY_USAGE, error: string | null = null,
  ): TelemetryRow {
    const report = view.state.pendingReport
    return {
      turnNumber: view.turnNumber, kind, model: this.model, latencyMs,
      promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cachedTokens: usage.cachedTokens, costUsd: usage.costUsd,
      menuSize, plan: [], applied: [], expectation: null,
      report: kind === 'decision' && report ? { results: report.results, repairs: report.repairs } : null,
      tableTalk: null, fallbackReason: reason, error,
      section: null, seq: null,
    }
  }
}
