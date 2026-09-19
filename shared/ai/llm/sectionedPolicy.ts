import type { GameAction } from '../../engine/engineTypes.ts'
import type { BotPolicy, OwedKind, PolicyHooks } from '../basicPolicy.ts'
import type { BotView } from '../botView.ts'
import { ANSWER_SCHEMA, parseAnswer } from './answerSchema.ts'
import type { Answer, Then } from './answerSchema.ts'
import { firstMessage, followUpMessage, itemsFor, numberedMenu } from './conversation.ts'
import type { Numbered } from './conversation.ts'
import { EMPTY_USAGE, LlmHttpError, LlmTimeoutError } from './llmClient.ts'
import type { ChatMessage, LlmClient, LlmUsage } from './llmClient.ts'
import { DEFAULT_LLM_POLICY_SETTINGS } from './llmPolicy.ts'
import type { LlmPolicySettings } from './llmPolicy.ts'
import { ACTIONS_PER_ANSWER, LLM_MAX_OUTPUT_TOKENS, LLM_TEMPERATURE, SECTION_MAX_ACTIONS } from './llmSettings.ts'
import { sameAction } from './moveMenu.ts'
import type { MenuItem } from './moveMenu.ts'
import { buildSystemPrompt } from './prompt.ts'
import { inSection, nextSection, SECTION_MARKERS } from './sections.ts'
import type { Section } from './sections.ts'
import type { FallbackReason, TelemetryRow } from './telemetry.ts'

// The sectioned, conversational policy (2026-09-18 sectioned bot turn spec
// §5.3). One instance per request: it holds the message history, the
// section pointer, the move counts, and the telemetry rows. Like LlmPolicy
// it only ever suggests — every move it offers is a verified menu item, the
// fallback's candidates trail every answer (the evaluator in production —
// makePolicy.ts — so a tripped or disabled policy still plays by score, not
// at random), and any failure trips it for the rest of the request. Unlike
// LlmPolicy it asks for one move at a time, so every annotation the model
// reads was simulated from the board it is looking at.
interface Asked { answer: Answer; items: MenuItem[]; row: TelemetryRow }

const advanceFrom = (section: Section): Section => nextSection(section) ?? 'finish'

export class SectionedLlmPolicy implements BotPolicy {
  readonly rows: TelemetryRow[] = []
  readonly settings: LlmPolicySettings
  private readonly client: LlmClient | null
  private readonly fallback: BotPolicy
  private readonly model: string
  private readonly now: () => number
  private readonly messages: ChatMessage[] = []   // user/assistant only; the primer is prepended per call
  private section: Section | null = null
  private announced: Section | null = null         // the last section whose marker went out
  private advance = false                          // the pointer must move before the next turn call
  private sawDecision = false                      // a turn after a decision is a resumed one (§3.4)
  private pendingThen: Then | null = null
  private readonly moves: Record<Section, number> = { deploy: 0, activate: 0, fight: 0, finish: 0 }
  private plan: MenuItem[] = []                    // actionsPerAnswer above one only
  private planRow: TelemetryRow | null = null      // the row the plan's moves belong to
  private expected: GameAction | null = null       // what the driver should accept next
  private expectedRow: TelemetryRow | null = null  // the row that move belongs to
  private lastOutcome: string | null = null
  private lastHandKey: string | null = null
  private boardDue = false                         // re-send the board: a section start
  private pendingTalk: string | null = null
  private tripped: FallbackReason | null = null
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

  async candidates(view: BotView, kind: OwedKind, hooks?: PolicyHooks): Promise<GameAction[]> {
    if (this.tripped) {
      if (this.tripped === 'disabled' && this.rows.length === 0) this.rows.push(this.row(view, kind, null, null, 0, 0, 'disabled'))
      return this.fallback.candidates(view, kind)
    }
    const menu = view.menu ?? []
    if (kind === 'decision') this.sawDecision = true
    if (kind !== 'turn') return this.oneMove(view, kind, menu)
    return this.turnMove(view, menu, hooks)
  }

  // A response, a decision or a choice: one call, one move. An empty menu (a
  // report nobody can approve) is the driver's fallback — no call, no row.
  private async oneMove(view: BotView, kind: OwedKind, menu: MenuItem[]): Promise<GameAction[]> {
    if (menu.length === 0) return this.fallback.candidates(view, kind)
    const asked = await this.ask(view, kind, null, numberedMenu(menu, null))
    if (asked === null) return this.fallback.candidates(view, kind)
    if (asked.items.length === 0) {
      // A pass: the heuristic answers this call and the policy stays up (§3.3).
      asked.row.fallbackReason = 'passed'
      this.pendingTalk = asked.row.tableTalk ?? this.pendingTalk
      return this.fallback.candidates(view, kind)
    }
    this.propose(asked.items[0], asked.row, null)
    return [asked.items[0].action, ...(await this.fallback.candidates(view, kind))]
  }

  // The pointer is a local while it moves — TypeScript does not narrow a
  // class property across the awaits below — and is written back to
  // this.section wherever the method returns.
  private async turnMove(view: BotView, menu: MenuItem[], hooks?: PolicyHooks): Promise<GameAction[]> {
    let section: Section = this.section ?? (this.sawDecision ? 'activate' : 'deploy')
    this.section = section
    // A plan in hand (actionsPerAnswer above one) whose head is still on the
    // menu — re-verified against the current board, as LlmPolicy does.
    const head = this.plan[0]
    if (head) {
      if (menu.some((m) => sameAction(m.action, head.action))) {
        this.plan.shift()
        this.expected = head.action
        this.expectedRow = this.planRow
        return [head.action, ...(await this.fallback.candidates(view, 'turn'))]
      }
      this.plan = []
    }
    if (this.advance) {
      this.advance = false
      if (section === 'finish') return this.endTurn(view, menu)
      section = advanceFrom(section)
    }
    for (;;) {
      // Skip forward over an empty section or one at its move cap (§3.2 step
      // 2); finish is never skipped, and at its cap the turn ends.
      while (section !== 'finish' && (this.itemsIn(menu, section).length === 0 || this.moves[section] >= SECTION_MAX_ACTIONS)) {
        section = advanceFrom(section)
      }
      this.section = section
      if (section === 'finish' && this.moves.finish >= SECTION_MAX_ACTIONS) return this.endTurn(view, menu)
      if (this.announced !== section) {
        this.announced = section
        this.boardDue = true
        if (hooks) await hooks.checkpoint(SECTION_MARKERS[section])
      }
      const asked = await this.ask(view, 'turn', section, numberedMenu(menu, section))
      if (asked === null) return this.fallback.candidates(view, 'turn')
      if (asked.items.length === 0) {
        this.pendingTalk = asked.row.tableTalk ?? this.pendingTalk
        this.lastOutcome = `You chose nothing in ${section.toUpperCase()}.`
        if (section === 'finish') return this.endTurn(view, menu)
        section = advanceFrom(section)
        continue
      }
      this.propose(asked.items[0], asked.row, asked.answer.then)
      this.plan = asked.items.slice(1)
      this.planRow = asked.row
      return [asked.items[0].action, ...(await this.fallback.candidates(view, 'turn'))]
    }
  }

  private itemsIn(menu: MenuItem[], section: Section): MenuItem[] {
    return menu.filter((m) => inSection(m.section, section))
  }

  // END TURN from the menu, no call, no row (§3.2 step 3).
  private async endTurn(view: BotView, menu: MenuItem[]): Promise<GameAction[]> {
    const end = menu.find((m) => m.action.type === 'END_TURN')
    this.expected = end ? end.action : null
    this.expectedRow = null
    this.pendingThen = null
    const tail = await this.fallback.candidates(view, 'turn')
    return end ? [end.action, ...tail] : tail
  }

  private propose(item: MenuItem, row: TelemetryRow, then: Then | null): void {
    this.expected = item.action
    this.expectedRow = row
    if (then !== null) this.pendingThen = then
    this.pendingTalk = row.tableTalk ?? this.pendingTalk
  }

  onAccepted(action: GameAction, kind: OwedKind, outcome: string): string | null {
    if (this.expected && sameAction(this.expected, action)) {
      this.expected = null
      this.expectedRow?.applied.push(action)
      this.lastOutcome = outcome
      if (kind === 'turn' && this.section) {
        this.moves[this.section]++
        if (this.plan.length === 0 && this.pendingThen === 'next') this.advance = true
      }
      if (this.plan.length === 0) this.pendingThen = null
      const talk = this.pendingTalk
      this.pendingTalk = null
      return talk
    }
    // The engine took something else — the heuristic tail or the driver's
    // fallback. A verified turn move was refused: file it, drop the plan, and
    // let the model re-decide in the same section (§3.2 step 5). A one-move
    // kind the heuristic answered (a pass, an empty menu, a refusal) files the
    // same but leaves the turn's pending state alone — the move that raised a
    // choice keeps its `then` (§3.2 step 4, §3.3).
    if (this.expected && this.expectedRow && this.expectedRow.fallbackReason === null) this.expectedRow.fallbackReason = 'plan_rejected'
    this.lastOutcome = this.expected ? `The engine refused your move; instead: ${outcome}` : outcome
    if (kind === 'turn') {
      this.plan = []
      this.planRow = null
      this.pendingThen = null
      this.advance = false
    }
    this.expected = null
    this.expectedRow = null
    // A one-move kind the heuristic answered still speaks the line the
    // answer carried; a refused turn move's line may name what it did not
    // do, so it is dropped with the plan.
    const talk = kind === 'turn' ? null : this.pendingTalk
    this.pendingTalk = null
    return talk
  }

  // One model call on the conversation. Null after filing the failure and
  // tripping (budget, timeout, http, malformed). Latency is measured on the
  // policy's clock so the budget and the row agree.
  private async ask(view: BotView, kind: OwedKind, section: Section | null, numbered: Numbered): Promise<Asked | null> {
    if (this.calls >= this.settings.maxCalls || this.spentMs >= this.settings.requestBudgetMs) {
      this.tripped = 'budget'
      this.rows.push(this.row(view, kind, section, this.calls + 1, numbered.items.length, 0, 'budget'))
      return null
    }
    const handKey = view.hand.map((c) => c.instanceId).sort().join(',')
    const content = this.messages.length === 0
      ? firstMessage({ view, kind, section, numbered })
      : followUpMessage({ view, kind, section, numbered, outcome: this.lastOutcome ?? 'nothing changed', board: this.boardDue, hand: handKey !== this.lastHandKey })
    this.boardDue = false
    this.lastHandKey = handKey
    this.lastOutcome = null
    const user: ChatMessage = { role: 'user', content }
    const started = this.now()
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.settings.callTimeoutMs)
    this.calls++
    const seq = this.calls
    let text: string | null = null
    let usage: LlmUsage = EMPTY_USAGE
    let reason: FallbackReason | null = null
    let detail: string | null = null
    try {
      const res = await this.client!.complete({
        messages: [{ role: 'system', content: buildSystemPrompt(view.state.factions[view.side], 'sections') }, ...this.messages, user],
        schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
        schemaName: 'answer',
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
    const answer = reason === null && text !== null ? parseAnswer(text, this.settings.actionsPerAnswer ?? ACTIONS_PER_ANSWER) : null
    const items = answer ? itemsFor(numbered, answer.actions) : []
    if (reason === null && answer === null) {
      reason = 'malformed'
      detail = `unparseable answer: ${(text ?? '').slice(0, 160)}`
    } else if (reason === null && answer !== null && answer.actions.length > 0 && items.length === 0) {
      // Numbers the menu does not have: a hallucination, not a pass (§4.5).
      reason = 'malformed'
      detail = `unknown menu numbers: ${answer.actions.join(', ')}`
    }
    const row = this.row(view, kind, section, seq, numbered.items.length, latencyMs, reason, usage, detail)
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
    this.messages.push(user, { role: 'assistant', content: text! })
    return { answer: answer!, items, row }
  }

  private row(
    view: BotView, kind: OwedKind, section: Section | null, seq: number | null, menuSize: number, latencyMs: number,
    reason: FallbackReason | null, usage: LlmUsage = EMPTY_USAGE, error: string | null = null,
  ): TelemetryRow {
    const report = view.state.pendingReport
    return {
      turnNumber: view.turnNumber, kind, model: this.model, latencyMs,
      promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, cachedTokens: usage.cachedTokens, costUsd: usage.costUsd,
      menuSize, plan: [], applied: [], expectation: null,
      report: kind === 'decision' && report ? { results: report.results, repairs: report.repairs } : null,
      tableTalk: null, fallbackReason: reason, error,
      section, seq, guard: null,
    }
  }
}
