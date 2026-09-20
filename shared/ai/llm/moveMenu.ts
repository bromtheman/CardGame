import { HERO_POWER_DISTANCE_MOD_M, TRIGGERS } from '../../gameSettings.ts'
import type { EngineContext, EngineGame, GameAction, Side } from '../../engine/engineTypes.ts'
import type { CardInstance } from '../../engine/gameInit.ts'
import {
  activateCpCostOf, activateMaterialCostOf, applyAction, effectName, effectiveMaterialCostOf,
  FACTION_POWERS, sideOf,
} from '../../engine/index.ts'
import type { OwedKind } from '../basicPolicy.ts'
import { repairableParticipants } from '../basicPolicy.ts'
import { scoreMove } from '../evaluator.ts'
import { FALLBACK } from '../fallbacks.ts'
import { mulberry32 } from '../seededRng.ts'
import { describeMenuItem } from './describe.ts'
import { MENU_MAX_ITEMS, MENU_MAX_TRIALS, MENU_SCORE_WINDOW_TURNS } from './llmSettings.ts'
import { sectionOf } from './sections.ts'
import type { Section } from './sections.ts'

// One verified-legal move, as the model sees it (spec §4). Ids are 1-based
// and private to one menu; a plan is mapped to actions the moment it is
// parsed and compared with sameAction from then on. `section` is where the
// sectioned flow shows the item (2026-09-18 spec §3.1); null for the
// one-move kinds. `score` is the tempo delta against END TURN (2026-09-19
// scored-menu spec §3.5), computed only for turn-kind menus; null otherwise.
export interface MenuItem { id: number; action: GameAction; text: string; section: Section | null; score: number | null }

// The bracketed tempo delta a menu line carries (spec §6.1): one decimal,
// signed, a plain zero for END TURN and for a rounding-zero; nothing for an
// unscored item.
export function tempoTag(score: number | null): string {
  if (score === null) return ''
  const r = Math.round(score * 10) / 10
  return ` [${r > 0 ? '+' : ''}${r.toFixed(1)}]`
}

// The items shown to the model under the window (spec §6.3): those within
// `window` of the best score, unscored items, and END TURN always.
export function withinWindow(menu: MenuItem[], window: number = MENU_SCORE_WINDOW_TURNS): MenuItem[] {
  if (!Number.isFinite(window)) return menu
  const best = Math.max(...menu.map((m) => m.score ?? -Infinity))
  return menu.filter((m) => m.score === null || m.action.type === 'END_TURN' || m.score >= best - window)
}

// Every action type the enumerator can emit. moveMenu.test.ts pins this list
// plus MENU_EXCLUDED_TYPES against the engine's knownActionTypes(), so a new
// action type fails CI until the menu offers it (spec §4.5).
export const MENU_ACTION_TYPES: readonly GameAction['type'][] = [
  'END_TURN', 'ATTACK_ENEMY_BASE', 'ATTACK_ENEMY_FLEET', 'PLAY_CARD_TO_ZONE', 'PLAY_ABILITY_CARD',
  'PLAY_CARD_TARGETING_CARD_ON_FIELD', 'PLAY_CARD_TARGETING_CARD_IN_HAND', 'USE_HERO_POWER',
  'SET_ALERT_CARD', 'MOVE_VEHICLE', 'ACTIVATE_VEHICLE', 'RESPOND_TO_ATTACK', 'DECIDE_BATTLE_REPORT',
  'RESOLVE_PENDING_EFFECT',
]
// Never offered: the bot never concedes, abandons or submits a report
// (AI opponent spec §11, rulings 2 and 3).
export const MENU_EXCLUDED_TYPES: readonly GameAction['type'][] = ['CONCEDE', 'ABANDON', 'SUBMIT_BATTLE_REPORT']

function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`
  if (x !== null && typeof x === 'object') {
    const o = x as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(x)
}
export const sameAction = (a: GameAction, b: GameAction): boolean => canonical(a) === canonical(b)

const byCostDesc = (a: CardInstance, b: CardInstance): number => effectiveMaterialCostOf(b) - effectiveMaterialCostOf(a)
type HeroPowerAction = Extract<GameAction, { type: 'USE_HERO_POWER' }>

// Spec §4.1, in the table's cell order — the order the trial cap cuts in.
function enumerateTurn(game: EngineGame, side: Side): GameAction[] {
  const s = game.state
  const enemy: Side = side === 'a' ? 'b' : 'a'
  const zones = s.zones
  const hand = game.privates[side].hand
  const mine = zones.flatMap((z) => z.cards[side].map((card) => ({ zone: z, card })))
  const theirs = zones.flatMap((z) => z.cards[enemy].map((card) => ({ zone: z, card })))
  const fieldIds = [...mine, ...theirs].map((x) => x.card.instanceId)
  const otherHandIds = (card: CardInstance) => hand.filter((c) => c.instanceId !== card.instanceId).map((c) => c.instanceId)
  const out: GameAction[] = [{ type: 'END_TURN' }]

  for (const z of zones) out.push({ type: 'ATTACK_ENEMY_BASE', zoneId: z.id }, { type: 'ATTACK_ENEMY_FLEET', zoneId: z.id })

  // Plays, in basicPolicy's order (vehicles before abilities, dearer first) so
  // a capped menu keeps the plays the heuristic would rank first. The action
  // shape per trigger key is HandBar.tsx's dispatch, as in basicPolicy.
  const vehicles = hand.filter((c) => c.type === 'vehicle').sort(byCostDesc)
  const abilities = hand.filter((c) => c.type !== 'vehicle').sort(byCostDesc)
  for (const card of vehicles) {
    for (const z of zones) {
      if (effectName(card, TRIGGERS.PLAY_ON_CARD) !== null) {
        for (const targetInstanceId of otherHandIds(card)) {
          out.push({ type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: card.instanceId, targetInstanceId, zoneId: z.id })
        }
      }
      out.push({ type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: z.id })
    }
  }
  for (const card of abilities) {
    if (effectName(card, TRIGGERS.PLAY_ON_ZONE) !== null) {
      for (const z of zones) out.push({ type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: z.id })
    } else if (effectName(card, TRIGGERS.PLAY_ON_VEHICLE) !== null) {
      for (const targetInstanceId of fieldIds) out.push({ type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId })
    } else if (effectName(card, TRIGGERS.PLAY_ON_CARD) !== null) {
      for (const targetInstanceId of otherHandIds(card)) out.push({ type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: card.instanceId, targetInstanceId })
    } else {
      out.push({ type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    }
  }

  // Hero powers × their parameter spaces. A power already used, or owned by
  // another faction, is skipped rather than tried — the engine would refuse
  // it, and Boarding Party's ship × ship product is the one that adds up.
  const faction = s.factions[side]
  const usable = (power: HeroPowerAction): boolean => {
    if (s.usedHeroPowers[side].includes(power.power)) return false
    const owner = (FACTION_POWERS as Record<string, string>)[power.power]
    return owner === undefined || owner === faction
  }
  const powers: HeroPowerAction[] = [{ type: 'USE_HERO_POWER', power: 'draw' }]
  for (const c of s.destroyed[side]) if (c.type === 'vehicle') powers.push({ type: 'USE_HERO_POWER', power: 'salvage', cardId: c.cardId })
  for (const delta of [HERO_POWER_DISTANCE_MOD_M, -HERO_POWER_DISTANCE_MOD_M]) powers.push({ type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: delta })
  for (const { zone, card } of mine) {
    for (const z of zones) if (z.id !== zone.id) powers.push({ type: 'USE_HERO_POWER', power: 'rapidRedeployment', instanceId: card.instanceId, zoneId: z.id })
    if (card.vehicleType === 'ship') {
      for (const t of theirs) {
        if (t.zone.id === zone.id && t.card.vehicleType === 'ship') {
          powers.push({ type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: card.instanceId, targetInstanceId: t.card.instanceId })
        }
      }
    }
    powers.push({ type: 'USE_HERO_POWER', power: 'counterIntelligence', instanceId: card.instanceId })
  }
  for (const card of hand) {
    powers.push({ type: 'USE_HERO_POWER', power: 'changeOrder', instanceId: card.instanceId })
    powers.push({ type: 'USE_HERO_POWER', power: 'flyby', instanceId: card.instanceId })
  }
  powers.push({ type: 'USE_HERO_POWER', power: 'drones' })
  for (const z of zones) powers.push({ type: 'USE_HERO_POWER', power: 'flankingManeuver', zoneId: z.id })
  out.push(...powers.filter(usable))

  for (const card of hand) out.push({ type: 'SET_ALERT_CARD', instanceId: card.instanceId })
  for (const { zone, card } of mine) {
    for (const z of zones) if (z.id !== zone.id) out.push({ type: 'MOVE_VEHICLE', instanceId: card.instanceId, zoneId: z.id })
  }
  // activate.ts's rule: an activation needs onActivate AND at least one price.
  for (const { card } of mine) {
    if (effectName(card, TRIGGERS.ON_ACTIVATE) === null) continue
    if (activateCpCostOf(card) === null && activateMaterialCostOf(card) === null) continue
    out.push({ type: 'ACTIVATE_VEHICLE', instanceId: card.instanceId })
    for (const z of zones) out.push({ type: 'ACTIVATE_VEHICLE', instanceId: card.instanceId, zoneId: z.id })
    for (const targetInstanceId of fieldIds) out.push({ type: 'ACTIVATE_VEHICLE', instanceId: card.instanceId, targetInstanceId })
  }
  return out
}

function enumerateResponse(game: EngineGame): GameAction[] {
  const p = game.state.awaitingResponse
  if (!p) return []
  const eligible = [...new Set([...p.stealthyIds, ...(p.omissibleIds ?? [])])]
  const out: GameAction[] = [{ type: 'RESPOND_TO_ATTACK', optOutIds: [] }]
  if (eligible.length > 1) out.push({ type: 'RESPOND_TO_ATTACK', optOutIds: eligible })
  for (const id of eligible) out.push({ type: 'RESPOND_TO_ATTACK', optOutIds: [id] })
  return out
}

// The bot never rejects a report by choice — it approves whatever the
// engine lets it approve (parent spec §11.2). Reject survives only as the
// driver's FALLBACK.decision for a report nobody can approve; it is
// deliberately not enumerated here.
function enumerateDecision(game: EngineGame, side: Side): GameAction[] {
  const out: GameAction[] = [
    { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [] },
  ]
  const eligible = repairableParticipants(game.state, side).map((e) => e.instanceId)
  for (let n = 1; n <= eligible.length; n++) out.push({ type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: eligible.slice(0, n) })
  if (eligible.length > 1) for (const id of eligible) out.push({ type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [id] })
  return out
}

function enumerateChoice(game: EngineGame, side: Side): GameAction[] {
  const p = game.state.pendingEffect
  if (!p || p.side !== side) return []
  return [
    ...p.options.map((o): GameAction => ({ type: 'RESOLVE_PENDING_EFFECT', choiceId: o.id })),
    { type: 'RESOLVE_PENDING_EFFECT', cancel: true },
  ]
}

export function enumerate(game: EngineGame, side: Side, kind: OwedKind): GameAction[] {
  const raw = kind === 'turn' ? enumerateTurn(game, side)
    : kind === 'response' ? enumerateResponse(game)
    : kind === 'decision' ? enumerateDecision(game, side)
    : enumerateChoice(game, side)
  const seen = new Set<string>()
  return raw.filter((a) => { const k = canonical(a); if (seen.has(k)) return false; seen.add(k); return true })
}

// Enumerate, verify each on a clone (the engine prunes the unaffordable, the
// The one move the menu withholds that the engine would accept: a fleet
// attack every defender may withdraw from (2026-09-16 AI opponent spec
// §6.1, the heuristic's rule, extended to the menu on 2026-09-20). The
// human withdraws at no cost — the attack is called off with the zone
// activation unspent and the state otherwise unchanged (design spec §3.4) —
// the next request rebuilds this same menu, and a policy that reads only
// the board (every policy here; the evaluator scores the fight as if the
// human stood and fought, tens of turns above END TURN, which the tempo
// guard then enforces over a model's pass) declares it again: a withdrawal
// per lap for the human, forever. Read off the response window the trial
// itself opened — exactly what the engine says the defender may withdraw,
// whichever list it came from — never re-derived; and only a window this
// trial opened, so an answer to a window already standing is never judged.
export function calledOffAtWill(before: EngineGame, trial: EngineGame): boolean {
  const opened = trial.state.awaitingResponse
  if (!opened || before.state.awaitingResponse) return false
  const optOut = new Set([...opened.stealthyIds, ...(opened.omissibleIds ?? [])])
  return opened.targetIds.every((id) => optOut.has(id))
}

// Enumerate, verify each on a clone (the engine prunes the unaffordable, the
// wrong-phase, the already-activated; the menu itself prunes only what
// calledOffAtWill names), annotate the survivors, cap. The
// trials run on their own rng, seeded by ONE draw from ctx.rng, so a menu of
// any size costs the game's stream exactly one value (spec §4.2). The kept
// action is the driver's own FALLBACK per kind (imported, not restated — see
// shared/ai/fallbacks.ts), so a capped menu never drops the one move the
// driver is guaranteed to fall back to.
export function buildMenu(game: EngineGame, botId: string, ctx: EngineContext, kind: OwedKind): MenuItem[] {
  const side = sideOf(game, botId)
  if (!side) throw new Error(`PracticeAI (${botId}) is not in this game`)
  // One rng draw seeds every trial and every score of this build (the
  // "draws exactly one rng value" test), so a build is deterministic.
  const seedBase = Math.floor(ctx.rng() * 2 ** 32)
  const trialCtx: EngineContext = { ...ctx, rng: mulberry32(seedBase) }
  const items: MenuItem[] = []
  let trials = 0
  for (const action of enumerate(game, side, kind)) {
    if (trials++ >= MENU_MAX_TRIALS) break
    // The menu exercises far more engine paths than the heuristic ever did,
    // and a latent handler throw must not become a 500 on the human's
    // click — a thrown trial means "not offered", same as an ok:false one.
    let r
    try {
      r = applyAction(game, botId, action, trialCtx)
    } catch {
      continue
    }
    if (!r.ok || calledOffAtWill(game, r.game)) continue
    items.push({ id: 0, action, text: describeMenuItem(game, r.game, side, action), section: sectionOf(action), score: null })
  }
  // The item cap is per section (2026-09-18 spec §6): the sectioned flow
  // shows one section at a time, and a busy deploy must not crowd out the
  // attacks. In practice no section nears it (turn menus peak near fifty).
  const seenPerSection = new Map<Section | null, number>()
  const kept = items.filter((m) => {
    const n = seenPerSection.get(m.section) ?? 0
    seenPerSection.set(m.section, n + 1)
    return n < MENU_MAX_ITEMS
  })
  const keep = FALLBACK[kind]
  if (!kept.some((m) => sameAction(m.action, keep))) {
    const fallback = items.find((m) => sameAction(m.action, keep))
    if (fallback) kept[kept.length - 1] = fallback
  }
  const numbered = kept.map((item, i) => ({ ...item, id: i + 1 }))
  return kind === 'turn' ? scored(game, botId, ctx, numbered, seedBase) : numbered
}

// Every turn item's tempo delta against END TURN (spec §3.5). An item whose
// trial cannot be completed keeps null and stays offered.
function scored(game: EngineGame, botId: string, ctx: EngineContext, items: MenuItem[], seedBase: number): MenuItem[] {
  const raw = items.map((m, i) => {
    // scoreMove re-runs the action (plus battle samples and choice
    // settling) on a different seed than the trial that already verified
    // it — same rule as that trial's own try/catch: a thrown score means
    // null for this one item, not a 500 for the whole menu.
    try {
      return scoreMove(game, botId, m.action, ctx, (seedBase + 1 + i) >>> 0)
    } catch {
      return null
    }
  })
  const endIndex = items.findIndex((m) => m.action.type === 'END_TURN')
  const end = endIndex >= 0 ? raw[endIndex] : null
  return items.map((m, i) => ({ ...m, score: raw[i] === null || end === null ? null : raw[i]! - end }))
}
