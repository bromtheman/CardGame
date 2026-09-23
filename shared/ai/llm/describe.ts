import { HERO_POWER_LABELS, KEYWORDS } from '../../gameSettings.ts'
import type { EngineGame, GameAction, Side } from '../../engine/engineTypes.ts'
import { effectiveMaterialCostOf, repairCostOf, upkeepOwedBy } from '../../engine/index.ts'
import { shortHandNumber } from '../../format.ts'
import { materialsPerTurnOf } from '../../lobbySettings.ts'
import { MENU_LOG_LINES_PER_ITEM } from './llmSettings.ts'
import { newLogLines } from './logDelta.ts'

// Text for one menu item (spec §4.3): what the move is, then what the engine
// did with it on a clone. Names come from the bot's OWN hand, the field
// (both sides) and a battle's summons — never the opponent's hand, which no
// enumerated action can reference anyway.

const money = (n: number): string => shortHandNumber(n)

type Named = { name: string; materialCost: number; keywords: string[] }
function cardOf(game: EngineGame, side: Side, instanceId: string): Named | null {
  for (const c of game.privates[side].hand) if (c.instanceId === instanceId) return c
  for (const z of game.state.zones) {
    for (const s of ['a', 'b'] as const) {
      for (const c of z.cards[s]) if (c.instanceId === instanceId) return c
    }
  }
  for (const s of game.state.activeBattle?.summons ?? []) if (s.instanceId === instanceId) return s
  return null
}
const nameOf = (game: EngineGame, side: Side, id: string): string => cardOf(game, side, id)?.name ?? id
const named = (game: EngineGame, side: Side, id: string): string => {
  const c = cardOf(game, side, id)
  return c ? `${c.name} (${money(effectiveMaterialCostOf(c))})` : id
}

export function describeAction(game: EngineGame, side: Side, action: GameAction): string {
  switch (action.type) {
    case 'END_TURN': return 'END TURN'
    case 'ATTACK_ENEMY_BASE': return `ATTACK the enemy base in zone ${action.zoneId}`
    case 'ATTACK_ENEMY_FLEET': return `ATTACK the enemy fleet in zone ${action.zoneId}`
    case 'PLAY_CARD_TO_ZONE': return `PLAY ${named(game, side, action.instanceId)} to zone ${action.zoneId}`
    case 'PLAY_ABILITY_CARD': return `PLAY ${named(game, side, action.instanceId)}`
    case 'PLAY_CARD_TARGETING_CARD_ON_FIELD':
      return `PLAY ${named(game, side, action.instanceId)} on ${nameOf(game, side, action.targetInstanceId)}`
    case 'PLAY_CARD_TARGETING_CARD_IN_HAND':
      return `PLAY ${named(game, side, action.instanceId)} with ${nameOf(game, side, action.targetInstanceId)} from hand` +
        (action.zoneId !== undefined ? ` to zone ${action.zoneId}` : '')
    case 'MOVE_VEHICLE': return `MOVE ${nameOf(game, side, action.instanceId)} to zone ${action.zoneId}`
    case 'ACTIVATE_VEHICLE':
      return `ACTIVATE ${nameOf(game, side, action.instanceId)}` +
        (action.targetInstanceId ? ` on ${nameOf(game, side, action.targetInstanceId)}` : '') +
        (action.zoneId !== undefined ? ` in zone ${action.zoneId}` : '')
    case 'SET_ALERT_CARD': return `REVEAL ${nameOf(game, side, action.instanceId)} as your alert card`
    case 'USE_HERO_POWER': {
      const label = `HERO POWER ${HERO_POWER_LABELS[action.power] ?? action.power}`
      switch (action.power) {
        case 'salvage': {
          const card = game.state.destroyed[side].find((c) => c.cardId === action.cardId)
          return `${label}: ${card?.name ?? action.cardId} back to hand`
        }
        case 'tacticalPositioning': return `${label}: ${action.distanceDeltaM && action.distanceDeltaM > 0 ? '+' : ''}${action.distanceDeltaM}m`
        case 'rapidRedeployment': return `${label}: ${nameOf(game, side, action.instanceId ?? '')} to zone ${action.zoneId}`
        case 'boardingParty':
          return `${label}: trade ${nameOf(game, side, action.instanceId ?? '')} for ${nameOf(game, side, action.targetInstanceId ?? '')}`
        case 'changeOrder': case 'flyby': case 'counterIntelligence':
          return `${label}: ${nameOf(game, side, action.instanceId ?? '')}`
        case 'flankingManeuver': case 'surge': return `${label}: zone ${action.zoneId}`
        default: return label
      }
    }
    case 'RESPOND_TO_ATTACK':
      return action.optOutIds.length === 0 ? 'FIGHT with every defender'
        : `WITHDRAW ${action.optOutIds.map((id) => nameOf(game, side, id)).join(', ')} from the defence`
    case 'DECIDE_BATTLE_REPORT': {
      if (!action.approve) return 'REJECT the battle report'
      const repairs = action.repairs ?? []
      if (repairs.length === 0) return 'APPROVE the report and repair nothing'
      const parts = repairs.map((id) => {
        const c = cardOf(game, side, id)
        return c ? `${c.name} (${money(repairCostOf(c))})` : id
      })
      return `APPROVE the report and repair ${parts.join(', ')}`
    }
    case 'RESOLVE_PENDING_EFFECT': {
      if (action.cancel) return 'DECLINE the choice'
      const option = game.state.pendingEffect?.options.find((o) => o.id === action.choiceId)
      return `CHOOSE "${option?.label ?? action.choiceId}"`
    }
    case 'CONCEDE': case 'ABANDON': case 'SUBMIT_BATTLE_REPORT': return action.type
  }
}

const sumCost = (cards: readonly { materialCost: number; keywords: string[] }[]): number =>
  cards.reduce((sum, c) => sum + effectiveMaterialCostOf(c), 0)

// state.destroyed is the general discard pile, not a casualty list: spendCard
// (placement.ts) files every resolved ABILITY card there too (PLAY_ABILITY_CARD,
// a played-to-zone/targeting ability, Change Order's scrapped hand vehicle), so
// a raw pile-length delta would describe a spent ability card as a lost hull.
// Count only vehicles.
const vehiclesIn = (pile: readonly { type: string }[]): number =>
  pile.filter((c) => c.type === 'vehicle').length

// Public-state diff only, plus own hand SIZE — never own hand contents: the
// drawn card is as unknown to the model at planning time as to a human.
export function describeOutcome(before: EngineGame, after: EngineGame, side: Side): string {
  const enemy: Side = side === 'a' ? 'b' : 'a'
  const b = before.state, a = after.state
  const parts: string[] = []
  if (a.resources[side].materials !== b.resources[side].materials) {
    parts.push(`materials ${money(b.resources[side].materials)}→${money(a.resources[side].materials)}`)
  }
  if (a.resources[side].cp !== b.resources[side].cp) parts.push(`CP ${b.resources[side].cp}→${a.resources[side].cp}`)
  const handDelta = after.privates[side].hand.length - before.privates[side].hand.length
  if (handDelta > 0) parts.push(`draw ${handDelta}`)
  if (handDelta < 0) parts.push(`hand ${before.privates[side].hand.length}→${after.privates[side].hand.length}`)
  for (const zb of b.zones) {
    const za = a.zones.find((z) => z.id === zb.id)
    if (!za) continue
    const zoneParts: string[] = []
    if (za.baseHp[enemy] !== zb.baseHp[enemy]) zoneParts.push(`enemy base ${zb.baseHp[enemy]}→${za.baseHp[enemy]}`)
    if (za.baseHp[side] !== zb.baseHp[side]) zoneParts.push(`your base ${zb.baseHp[side]}→${za.baseHp[side]}`)
    for (const [who, label] of [[side, 'your'], [enemy, 'enemy']] as const) {
      const beforeIds = new Set(zb.cards[who].map((c) => c.instanceId))
      const afterIds = new Set(za.cards[who].map((c) => c.instanceId))
      const added = za.cards[who].filter((c) => !beforeIds.has(c.instanceId)).map((c) => `+${c.name}`)
      const gone = zb.cards[who].filter((c) => !afterIds.has(c.instanceId)).map((c) => `−${c.name}`)
      if (added.length || gone.length) {
        zoneParts.push(`${label} hulls ${zb.cards[who].length}→${za.cards[who].length} (${[...added, ...gone].join(', ')})`)
      }
    }
    if (zoneParts.length) parts.push(`zone ${zb.id}: ${zoneParts.join(', ')}`)
  }
  const lost = vehiclesIn(a.destroyed[side]) - vehiclesIn(b.destroyed[side])
  const killed = vehiclesIn(a.destroyed[enemy]) - vehiclesIn(b.destroyed[enemy])
  if (lost > 0) parts.push(`you lose ${lost} hull${lost === 1 ? '' : 's'}`)
  if (killed > 0) parts.push(`enemy loses ${killed} hull${killed === 1 ? '' : 's'}`)
  if (a.pendingEffect && !b.pendingEffect) parts.push('asks you to choose')
  // A fleet attack opens a response window when a defender may withdraw,
  // and locks at once when none may — describe the declaration either way.
  const declaredZone = a.awaitingResponse && !b.awaitingResponse ? a.awaitingResponse.zoneId
    : a.activeBattle && !b.activeBattle ? a.activeBattle.zoneId : null
  if (declaredZone !== null) {
    const zone = b.zones.find((z) => z.id === declaredZone)
    if (zone) {
      const force = zone.cards[side].filter((c) => !c.keywords.includes(KEYWORDS.INOFFENSIVE))
      parts.push(`declares a fleet battle in zone ${zone.id} — yours ${money(sumCost(force))} vs theirs ${money(sumCost(zone.cards[enemy]))}`)
    }
  }
  if (a.activeBattle && !b.activeBattle) parts.push('battle locks; fought in From The Depths')
  if (a.activeBattle === null && b.activeBattle !== null) parts.push('battle resolved')
  if (after.activePlayer !== before.activePlayer) {
    // endTurn leaves the ending side's materials alone and OVERWRITES them
    // at that side's next turn start (gameEngine.ts), so the diff above is
    // silent for END TURN — and the model read the silence as banking
    // (2026-09-17 bot_decisions: "end turn to build materials for Scourge").
    // Price the turn end the way every other item is priced, and say that
    // next turn's income owes nothing to what is held now: floor(next turn)
    // × the lobby rate, less the upkeep the board would owe (U-3 clamp).
    const unspent = after.state.resources[side].materials
    if (unspent > 0) {
      const income = Math.max(0, Math.floor(before.turnNumber + 1) * materialsPerTurnOf(after.settings) - upkeepOwedBy(after.state, side))
      parts.push(`forfeits ${money(unspent)} unspent materials (next turn you get ${money(income)} either way)`)
    }
    parts.push('ends your turn')
  }
  if (after.status !== 'active') parts.push(`game over — ${after.winnerId === (side === 'a' ? after.playerA : after.playerB) ? 'you win' : 'you lose'}`)
  const lines = newLogLines(b.log, a.log).slice(0, MENU_LOG_LINES_PER_ITEM)
  if (lines.length) parts.push(`Log: ${lines.map((l) => `"${l}"`).join(' | ')}`)
  return parts.join('; ')
}

export function describeMenuItem(before: EngineGame, after: EngineGame, side: Side, action: GameAction): string {
  return `${describeAction(before, side, action)} → ${describeOutcome(before, after, side)}`
}
