#!/usr/bin/env -S npx tsx
// The strength bar for the model-backed PracticeAI (LLM spec §10.2): the
// model policy against basicPolicy over N seeded games, seats alternated,
// battles reported with rng-drawn HP by the harness. Never in CI.
//
//   npm run bot:eval -- --games 20 --model inception/mercury-2.5 [--flow sections|single] [--factions DWG,SS,WF] [--seed 1] [--reasoning high] [--providers streamlake]
// --flow mirrors BOT_FLOW (default sections); run both flows on the same seeds for the same-model comparison (sectioned spec §10.2).
// --factions picks the decks both seats rotate through; the default is the factions with ship profiles, the only ones the
// strength-based battle resolver (shared/ai/battleSim.ts) can judge — an unprofiled faction fights as bare cost.
//
// --reasoning and --providers take the same values as the BOT_REASONING_EFFORT
// and BOT_PROVIDERS secrets and default the same way (the model's rows in
// llmSettings.ts, else the model's own behaviour on any provider), so an
// eval measures what production sends.
// Needs OPENROUTER_API_KEY in the environment or ./.env.local (gitignored).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cardId, loadSeedData } from '../supabase/seed/transform.ts'
import type { SeedCard } from '../shared/types.ts'
import { applyAction } from '../shared/engine/index.ts'
import type { EngineGame } from '../shared/engine/engineTypes.ts'
import type { SnapshotCard } from '../shared/engine/gameInit.ts'
import { basicPolicy } from '../shared/ai/basicPolicy.ts'
import type { BotPolicy } from '../shared/ai/basicPolicy.ts'
import { botOwes, runBotUntilIdle } from '../shared/ai/botDriver.ts'
import { DEFAULT_LLM_POLICY_SETTINGS, LlmPolicy } from '../shared/ai/llm/llmPolicy.ts'
import { DEFAULT_BOT_MODEL, LLM_REQUEST_BUDGET_MS } from '../shared/ai/llm/llmSettings.ts'
import { botFlowFor, reasoningEffortFor, routingFor } from '../shared/ai/llm/makePolicy.ts'
import type { ModelBackedPolicy } from '../shared/ai/llm/makePolicy.ts'
import { OpenRouterClient } from '../shared/ai/llm/openRouterClient.ts'
import { SectionedLlmPolicy } from '../shared/ai/llm/sectionedPolicy.ts'
import type { TelemetryRow } from '../shared/ai/llm/telemetry.ts'
import { newGame, parseFactions, reportBattle, STEP_CAP, TURN_CAP } from '../shared/ai/selfPlayHarness.ts'

// Same shape selfPlay.test.ts builds; the harness itself stays seed-free.
function toSnapshot(card: SeedCard): SnapshotCard {
  return {
    cardId: cardId(card.faction, card.name), name: card.name, isBuiltIn: true, ownerId: null,
    faction: card.faction, type: card.type, vehicleType: card.vehicleType,
    blueprintCost: card.blueprintCost, materialCost: card.materialCost, cpCost: card.cpCost,
    cardText: card.cardText ?? '', imageUrl: card.imageUrl ?? '',
    keywords: card.keywords ?? [], meta: (card.meta ?? {}) as Record<string, unknown>,
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function envValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  const file = path.join(ROOT, '.env.local')
  if (!existsSync(file)) return undefined
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    if (line.slice(0, eq).replace(/^export\s+/, '').trim() !== key) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    return v
  }
  return undefined
}
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const key = envValue('OPENROUTER_API_KEY')
if (!key) { console.error('OPENROUTER_API_KEY is not set (environment or ./.env.local)'); process.exitCode = 1; throw new Error('no key') }
const games = Number(arg('games', '20'))
const model = arg('model', DEFAULT_BOT_MODEL)
const firstSeed = Number(arg('seed', '1'))
const factions = parseFactions(arg('factions', ''))
const flow = botFlowFor(arg('flow', 'sections'))
const settings = {
  ...DEFAULT_LLM_POLICY_SETTINGS,
  reasoningEffort: reasoningEffortFor(model, arg('reasoning', '')),
  routing: routingFor(model, arg('providers', '')),
}

const { cards } = await loadSeedData()
const catalog = cards.filter((c) => c.isBuiltIn).map(toSnapshot)
const byName = new Map(catalog.map((c) => [`${c.faction}:${c.name}`, c]))
const client = new OpenRouterClient(key, model)

interface Outcome { seed: number; modelSide: 'a' | 'b'; modelFaction: string; winner: 'model' | 'heuristic' | 'none'; turns: number; rows: TelemetryRow[]; requests: number; turnMs: number[] }
const outcomes: Outcome[] = []

for (let i = 0; i < games; i++) {
  const seed = firstSeed + i
  const modelSide: 'a' | 'b' = i % 2 === 0 ? 'b' : 'a'
  const factionA = factions[i % factions.length]
  const factionB = factions[(i + 1) % factions.length]
  const { game: start, ctx, rng } = newGame({ seed, factionA, factionB, catalog, byName })
  let game: EngineGame = start
  const rows: TelemetryRow[] = []
  const turnMs: number[] = []
  let requests = 0
  const act = async (side: 'a' | 'b') => {
    const id = side === 'a' ? 'alice' : 'bot'
    if (!botOwes(game, side)) return
    // One policy instance per "request", as production builds one per call.
    const modelPolicy: ModelBackedPolicy | null = side === modelSide
      ? (flow === 'single' ? new LlmPolicy(client, basicPolicy, model, settings) : new SectionedLlmPolicy(client, basicPolicy, model, settings))
      : null
    const policy: BotPolicy = modelPolicy ?? basicPolicy
    const t0 = Date.now()
    game = (await runBotUntilIdle(game, id, ctx, policy)).game
    if (modelPolicy) { rows.push(...modelPolicy.rows); turnMs.push(Date.now() - t0); requests++ }
  }
  for (let step = 0; step < STEP_CAP; step++) {
    await act('a')
    await act('b')
    if (game.status !== 'active' || game.turnNumber >= TURN_CAP) break
    if (game.state.activeBattle && !game.state.pendingReport && !game.state.pendingEffect) {
      // The harness plays reporter, as the human does in a practice game:
      // submitted by the DEFENDER, so the aggressor's driver owes the decision.
      const defender = game.state.activeBattle.aggressor === 'a' ? 'bot' : 'alice'
      const r = applyAction(game, defender, reportBattle(game, rng), ctx)
      if (!r.ok) throw new Error(`report refused (seed ${seed}): ${r.error}`)
      game = r.game
      continue
    }
    if (!botOwes(game, 'a') && !botOwes(game, 'b')) throw new Error(`nobody owes an action (seed ${seed}, turn ${game.turnNumber})`)
  }
  const modelId = modelSide === 'a' ? 'alice' : 'bot'
  const winner: Outcome['winner'] = game.status === 'active' ? 'none' : game.winnerId === modelId ? 'model' : 'heuristic'
  outcomes.push({ seed, modelSide, modelFaction: modelSide === 'a' ? factionA : factionB, winner, turns: game.turnNumber, rows, requests, turnMs })
  const cost = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0)
  console.log(`seed ${seed}: model as ${modelSide} vs heuristic → ${winner} in ${game.turnNumber} turns, ${rows.length} calls, $${cost.toFixed(4)}`)
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${Math.round((100 * n) / d)}%`)
const p = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0)
const allRows = outcomes.flatMap((o) => o.rows)
const allTurnMs = outcomes.flatMap((o) => o.turnMs)
const decided = outcomes.filter((o) => o.winner !== 'none')
const wins = outcomes.filter((o) => o.winner === 'model').length
const fallbacks = allRows.filter((r) => r.fallbackReason !== null)
console.log('')
console.log(`flow ${flow}, factions ${factions.join('/')}, model ${model} (reasoning ${settings.reasoningEffort ?? 'model default'}, routing ${settings.routing ? JSON.stringify(settings.routing) : 'default'}): ${wins}/${decided.length} decided games won (${pct(wins, decided.length)}), ${outcomes.length - decided.length} hit the ${TURN_CAP}-turn cap`)
console.log(`calls per model request: ${(allRows.length / Math.max(1, outcomes.reduce((s, o) => s + o.requests, 0))).toFixed(2)}`)
console.log(`model time per turn: p50 ${p(allTurnMs, 0.5)} ms, p95 ${p(allTurnMs, 0.95)} ms (budget ${LLM_REQUEST_BUDGET_MS} ms)`)
console.log(`tokens per call: prompt ${Math.round(allRows.reduce((s, r) => s + (r.promptTokens ?? 0), 0) / Math.max(1, allRows.length))}, cached ${Math.round(allRows.reduce((s, r) => s + (r.cachedTokens ?? 0), 0) / Math.max(1, allRows.length))}, completion ${Math.round(allRows.reduce((s, r) => s + (r.completionTokens ?? 0), 0) / Math.max(1, allRows.length))}`)
console.log(`cost per game: $${(allRows.reduce((s, r) => s + (r.costUsd ?? 0), 0) / Math.max(1, outcomes.length)).toFixed(4)}`)
const byReason = new Map<string, number>()
for (const r of fallbacks) byReason.set(r.fallbackReason!, (byReason.get(r.fallbackReason!) ?? 0) + 1)
console.log(`fallback rate: ${pct(fallbacks.length, allRows.length)}${byReason.size ? ` (${[...byReason].map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`)
// The faction the model held decides more games than the model does (2026-09-19:
// WF vs DWG swung 0–6 to 5–1 under one resolver), so the aggregate alone misleads.
console.log(`by model faction: ${factions.map((f) => { const g = decided.filter((o) => o.modelFaction === f); return `${f} ${g.filter((o) => o.winner === 'model').length}-${g.filter((o) => o.winner === 'heuristic').length}` }).join(', ')}`)
