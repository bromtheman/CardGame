import { KEYWORDS, REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT, TRIGGERS } from '../gameSettings.ts'
import type { GameAction, Side, ZoneCardEntry } from '../engine/engineTypes.ts'
import type { CardInstance, PublicGameState, ZoneState } from '../engine/gameInit.ts'
import {
  battleParticipants, canAfford, effectiveMaterialCostOf, effectName, fleetAttackRosters, fragileInBattle,
  legalZonesFor, otherSide, repairCostOf,
} from '../engine/index.ts'
import type { BotView } from './botView.ts'

// What the driver has found the bot owes (2026-09-16 AI opponent spec §5.1).
export type OwedKind = 'turn' | 'response' | 'decision' | 'choice'

// A policy proposes; the engine disposes. Candidates are best-first, and the
// driver applies the first one applyAction accepts — so a candidate may be
// illegal and nothing here has to know every rule.
export interface BotPolicy {
  candidates(view: BotView, kind: OwedKind): GameAction[]
}

// Fisher–Yates on a copy, driven by the view's rng so tests are deterministic.
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const byCostDesc = (a: CardInstance, b: CardInstance): number =>
  effectiveMaterialCostOf(b) - effectiveMaterialCostOf(a)

const strengthOf = (cards: readonly CardInstance[]): number =>
  cards.reduce((sum, c) => sum + effectiveMaterialCostOf(c), 0)

// Zone preference (spec §6.1): a live enemy base before a destroyed one, then
// the lowest enemy base HP, then the fewest enemy hulls — concentrate on
// finishing a base. Shuffled first so rng breaks the remaining ties (sort is
// stable).
export function zonesByPreference(view: BotView): ZoneState[] {
  const enemy = otherSide(view.side)
  return shuffled(view.state.zones, view.rng).sort((x, y) => {
    const xDead = x.baseHp[enemy] > 0 ? 0 : 1
    const yDead = y.baseHp[enemy] > 0 ? 0 : 1
    if (xDead !== yDead) return xDead - yDead
    if (x.baseHp[enemy] !== y.baseHp[enemy]) return x.baseHp[enemy] - y.baseHp[enemy]
    return x.cards[enemy].length - y.cards[enemy].length
  })
}

// Step 1 of a turn: every affordable hand card, vehicles before abilities and
// dearer before cheaper. Each card's action shape follows its trigger key,
// exactly as HandBar.tsx decides it for a human: playOnZoneEffect → a zone,
// playOnVehicleEffect → a hull on the field, playOnCardEffect → another hand
// card (with a zone too when the card is itself a vehicle), else a plain play.
// A hand-targeting vehicle offers the targeted plays first, then a plain
// PLAY_CARD_TO_ZONE fallback for that same zone — HandBar.tsx falls through
// the same way, so the hull stays playable with no legal hand target.
function playCandidates(view: BotView, zones: ZoneState[]): GameAction[] {
  const out: GameAction[] = []
  const affordable = view.hand.filter((c) => canAfford(view.state, view.side, c))
  const vehicles = affordable.filter((c) => c.type === 'vehicle').sort(byCostDesc)
  const abilities = affordable.filter((c) => c.type === 'ability').sort(byCostDesc)
  const fieldIds = shuffled(
    view.state.zones.flatMap((z) => [...z.cards.a, ...z.cards.b]).map((c) => c.instanceId),
    view.rng,
  )
  const otherHandIds = (card: CardInstance): string[] =>
    view.hand.filter((c) => c.instanceId !== card.instanceId).map((c) => c.instanceId)

  for (const card of vehicles) {
    const legal = legalZonesFor(view.state, view.side, card, view.turnNumber)
    const needsHandTarget = effectName(card, TRIGGERS.PLAY_ON_CARD) !== null
    for (const zone of zones) {
      if (!legal.includes(zone.id)) continue
      if (needsHandTarget) {
        for (const targetInstanceId of otherHandIds(card)) {
          out.push({
            type: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
            instanceId: card.instanceId, targetInstanceId, zoneId: zone.id,
          })
        }
      }
      out.push({ type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: zone.id })
    }
  }
  for (const card of abilities) {
    if (effectName(card, TRIGGERS.PLAY_ON_ZONE) !== null) {
      for (const zone of zones) {
        out.push({ type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: zone.id })
      }
    } else if (effectName(card, TRIGGERS.PLAY_ON_VEHICLE) !== null) {
      for (const targetInstanceId of fieldIds) {
        out.push({ type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: card.instanceId, targetInstanceId })
      }
    } else if (effectName(card, TRIGGERS.PLAY_ON_CARD) !== null) {
      for (const targetInstanceId of otherHandIds(card)) {
        out.push({ type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: card.instanceId, targetInstanceId })
      }
    } else {
      out.push({ type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
    }
  }
  return out
}

// Step 2 of a turn. Per zone in preference order: the base first (blocker,
// destroyed base, fresh deployment, zero damage and already-activated are all
// engine rejections — just try), then the fleet when the bot's non-Inoffensive
// hulls are at least as costly as the enemy's. Spec §3.4 as amended
// 2026-09-16: a fleet attack has no roster, so the only decision is whether.
// The rosters come from the engine's own derivation (fleetAttackRosters), the
// same one ATTACK_ENEMY_FLEET commits — so the force, the targets and the
// withdrawable ids here are exactly what the declaration would produce.
//
// A fleet the human can withdraw entirely is never worth declaring: every
// target Stealthy or omissible means the human either fights by choice or
// calls the attack off at no cost (no activation is spent, the state is
// unchanged), and a stateless policy would then re-declare it forever — the
// livelock the final whole-branch review found. Spec §6.1.
function attackCandidates(view: BotView, zones: ZoneState[]): GameAction[] {
  const out: GameAction[] = []
  const enemy = otherSide(view.side)
  for (const zone of zones) {
    const mine = zone.cards[view.side]
    if (mine.length === 0 || zone.lastActivatedTurn === view.turnNumber) continue
    if (zone.baseHp[enemy] > 0) out.push({ type: 'ATTACK_ENEMY_BASE', zoneId: zone.id })
    const rosters = fleetAttackRosters(view.state, view.side, zone.id)
    if (!rosters || rosters.force.length === 0 || rosters.targets.length === 0) continue
    const withdrawable = new Set([...rosters.stealthyIds, ...rosters.omissibleIds])
    if (rosters.targets.every((t) => withdrawable.has(t.instanceId))) continue
    if (strengthOf(rosters.force) >= strengthOf(rosters.targets)) {
      out.push({ type: 'ATTACK_ENEMY_FLEET', zoneId: zone.id })
    }
  }
  return out
}

// The bot's own participants worth offering a repair for (spec §6.2): in the
// repair band, not summons, not Fragile in this battle, not Scrappy (the
// engine repairs those free by itself — autoRepairIds). Dearest first.
// Exported: moveMenu.ts enumerates repair sets from exactly this list.
export function repairableParticipants(state: PublicGameState, side: Side): ZoneCardEntry[] {
  const battle = state.activeBattle
  const report = state.pendingReport
  if (!battle || !report) return []
  const summonIds = new Set(battle.summons.map((s) => s.instanceId))
  return [...battleParticipants(state).values()]
    .filter(({ entry, side: s }) => s === side && !summonIds.has(entry.instanceId))
    .filter(({ entry }) => {
      const hp = report.results[entry.instanceId]
      return hp !== undefined && hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT
    })
    .filter(({ entry, side: s }) => !fragileInBattle(battle, entry, s))
    .filter(({ entry }) => !entry.keywords.includes(KEYWORDS.SCRAPPY))
    .map(({ entry }) => entry)
    .sort(byCostDesc)
}

// Approve, repairing what is worth it (spec §6.2): dearest hull first from
// repairableParticipants, skipping any whose repair no longer fits the
// materials left. The bare approval follows as the second candidate, so a
// mismatch with the engine's own affordability check still resolves the
// report.
function decisionCandidates(view: BotView): GameAction[] {
  const bare: GameAction = { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [] }
  const repairs: string[] = []
  let budget = view.state.resources[view.side].materials
  for (const entry of repairableParticipants(view.state, view.side)) {
    const cost = repairCostOf(entry)
    if (cost > budget) continue
    budget -= cost
    repairs.push(entry.instanceId)
  }
  if (repairs.length === 0) return [bare]
  return [{ type: 'DECIDE_BATTLE_REPORT', approve: true, repairs }, bare]
}

// Every offered option, in rng order (spec §6.2). The driver tries them in
// turn and falls back to declining if the effect refuses them all.
function choiceCandidates(view: BotView): GameAction[] {
  const pending = view.state.pendingEffect
  if (!pending) return []
  return shuffled(pending.options, view.rng).map((o) => ({
    type: 'RESOLVE_PENDING_EFFECT' as const, choiceId: o.id,
  }))
}

export const basicPolicy: BotPolicy = {
  candidates(view, kind) {
    switch (kind) {
      case 'turn': {
        const zones = zonesByPreference(view)
        return [...playCandidates(view, zones), ...attackCandidates(view, zones), { type: 'END_TURN' }]
      }
      case 'response':
        return [{ type: 'RESPOND_TO_ATTACK', optOutIds: [] }]
      case 'decision':
        return decisionCandidates(view)
      case 'choice':
        return choiceCandidates(view)
    }
  },
}
