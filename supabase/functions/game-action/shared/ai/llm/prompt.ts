import type { CardInstance, ZoneState } from '../../engine/gameInit.ts'
import type { Side } from '../../engine/engineTypes.ts'
import { effectiveMaterialCostOf } from '../../engine/index.ts'
import { shortHandNumber } from '../../format.ts'
import type { OwedKind } from '../basicPolicy.ts'
import type { BotView } from '../botView.ts'
import { LOG_TAIL_LINES } from './llmSettings.ts'
import { tempoTag, withinWindow } from './moveMenu.ts'
import type { MenuItem } from './moveMenu.ts'
import { renderPrimer } from './rulesPrimer.ts'
import type { PrimerFlow } from './rulesPrimer.ts'
import { isSectionMarker } from './sections.ts'

// Built from the BotView and the menu, nothing else (spec §5.2, §5.5):
// public state, the bot's OWN hand, public counts. prompt.test.ts serialises
// the whole request body against known opponent secrets. The situation is
// exported block by block so conversation.ts (the sectioned flow) composes
// the same lines; buildUserPrompt is the single flow's composition.
export interface PromptInput {
  view: BotView
  kind: OwedKind
  menu: MenuItem[]
  situation?: string | null
  planSoFar?: MenuItem[]
}

export const buildSystemPrompt = (faction: string, flow: PrimerFlow = 'single'): string => renderPrimer(faction, flow)

const money = (n: number): string => shortHandNumber(n)
const enemyOf = (side: Side): Side => (side === 'a' ? 'b' : 'a')

// Card text is wrapped so the primer can name it as data; the name attribute
// carries no quotes of its own (names are plain words in the seed).
const cardTag = (c: { name: string; cardText: string }): string =>
  c.cardText.trim() === '' ? '' : ` <card name="${c.name.replace(/"/g, '')}">${c.cardText.trim()}</card>`

function hullLine(c: CardInstance, turnNumber: number): string {
  const entry = c as CardInstance & { playedOnTurn?: number; activatedOnTurn?: number | null }
  const flags: string[] = []
  if (entry.playedOnTurn === turnNumber) flags.push('played this turn')
  if (entry.activatedOnTurn === turnNumber) flags.push('activated this turn')
  const kw = c.keywords.length ? ` [${c.keywords.join(', ')}]` : ''
  return `${c.name} (${c.vehicleType ?? c.type}, ${money(effectiveMaterialCostOf(c))})${kw}${flags.length ? ` (${flags.join(', ')})` : ''}${cardTag(c)}`
}

function zoneBlock(z: ZoneState, side: Side, enemy: Side, turnNumber: number): string {
  const lines = [`Zone ${z.id} (${z.biome}) — your base ${z.baseHp[side]} HP, enemy base ${z.baseHp[enemy]} HP${z.lastActivatedTurn === turnNumber ? ', activated this turn' : ''}`]
  lines.push(`  Yours: ${z.cards[side].length ? z.cards[side].map((c) => hullLine(c, turnNumber)).join('; ') : 'none'}`)
  lines.push(`  Enemy: ${z.cards[enemy].length ? z.cards[enemy].map((c) => hullLine(c, turnNumber)).join('; ') : 'none'}`)
  return lines.join('\n')
}

export const ASK: Record<OwedKind, string> = {
  turn: 'It is your turn. Give your plan for the turn as menu numbers in order, ending with the END TURN number.',
  response: 'The enemy has declared a fleet attack on you. Choose one menu number: fight with everyone, or withdraw the Stealthy hulls you would rather keep.',
  decision: 'The human has reported the battle. Results are on the honour system: choose one menu number to approve the report, picking which of your damaged vehicles to repair.',
  choice: 'One of your effects asks for a choice. Choose one menu number.',
}

// The materials carry their expiry on a turn call: income is SET each turn
// (gameEngine.ts endTurn), and the model banked what it could have spent
// (2026-09-17 bot_decisions). A response or a decision may arrive on the
// opponent's turn, where "spend this turn" would misdirect.
export function resourcesLine(view: BotView, kind: OwedKind): string {
  const s = view.state
  const side = view.side
  const enemy = enemyOf(side)
  const spendCue = kind === 'turn' ? ' to spend this turn (anything unspent is lost when you end it)' : ''
  return `You: ${money(s.resources[side].materials)} materials${spendCue}, ${s.resources[side].cp} CP. Opponent: ${money(s.resources[enemy].materials)} materials, ${s.resources[enemy].cp} CP.`
}

export function headerLines(view: BotView, kind: OwedKind): string[] {
  const s = view.state
  const side = view.side
  const enemy = enemyOf(side)
  const out = [`Turn ${view.turnNumber} — you are player ${side.toUpperCase()} (${s.factions[side]}) against ${s.factions[enemy]}.`]
  out.push(resourcesLine(view, kind))
  out.push(`Opponent: ${s.counts[enemy].hand} card${s.counts[enemy].hand === 1 ? '' : 's'} in hand, ${s.counts[enemy].deck} in deck. You: ${s.counts[side].deck} in deck.`)
  if (s.usedHeroPowers[side].length) out.push(`Hero powers you have used: ${s.usedHeroPowers[side].join(', ')}.`)
  if (s.alertCard) out.push(`Alert card revealed by player ${s.alertCard.side.toUpperCase()}: ${s.alertCard.name}.`)
  return out
}

export function boardBlock(view: BotView): string[] {
  const s = view.state
  return ['BOARD', ...s.zones.map((z) => zoneBlock(z, view.side, enemyOf(view.side), view.turnNumber))]
}

export function handBlock(view: BotView): string[] {
  return ['YOUR HAND', view.hand.length
    ? view.hand.map((c) => `- ${c.name} (${c.type}${c.vehicleType ? `/${c.vehicleType}` : ''}, ${money(effectiveMaterialCostOf(c))}${c.cpCost ? `, ${c.cpCost} CP` : ''})${c.keywords.length ? ` [${c.keywords.join(', ')}]` : ''}${cardTag(c)}`).join('\n')
    : '- (empty)']
}

// What is owed besides a turn: the choice, the incoming attack, the report.
// Empty for a turn.
export function kindBlock(view: BotView, kind: OwedKind): string[] {
  const s = view.state
  if (kind === 'choice' && s.pendingEffect) {
    return [`CHOICE from ${s.pendingEffect.card.name}: ${s.pendingEffect.prompt}`, s.pendingEffect.options.map((o) => `- ${o.label}`).join('\n')]
  }
  if (kind === 'response' && s.awaitingResponse) {
    const r = s.awaitingResponse
    return [`INCOMING ATTACK in zone ${r.zoneId}: ${r.attackerIds.length} attacker(s) against ${r.targetIds.length} of your hulls; ${[...new Set([...r.stealthyIds, ...r.omissibleIds])].length} may withdraw.`]
  }
  if (kind === 'decision' && s.pendingReport && s.activeBattle) {
    const rep = s.pendingReport
    return [`BATTLE REPORT for zone ${s.activeBattle.zoneId} (ending HP %): ${Object.entries(rep.results).map(([id, hp]) => `${nameIn(s, view, id)} ${hp}%`).join(', ')}.`]
  }
  return []
}

// The last LOG_TAIL_LINES public lines, without the bot's own section
// markers (2026-09-18 spec §4.1): they are bookkeeping, not events.
export function logTail(view: BotView): string[] {
  const tail = view.state.log.filter((l) => !isSectionMarker(l)).slice(-LOG_TAIL_LINES)
  return tail.length ? ['RECENT LOG', ...tail.map((l) => `- ${l}`)] : []
}

export function buildUserPrompt({ view, kind, menu, situation, planSoFar }: PromptInput): string {
  const out: string[] = [...headerLines(view, kind), '', ...boardBlock(view), '', ...handBlock(view)]
  const owed = kindBlock(view, kind)
  if (owed.length) out.push('', ...owed)
  const tail = logTail(view)
  if (tail.length) out.push('', ...tail)
  if (situation) out.push('', `SITUATION: ${situation}`)
  if (planSoFar && planSoFar.length) out.push(`Your plan so far: ${planSoFar.map((m) => `#${m.id} ${m.text}`).join(' | ')}`)
  out.push('', 'MENU')
  out.push(...(kind === 'turn' ? withinWindow(menu) : menu).map((m) => `#${m.id}${tempoTag(m.score)} ${m.text}`))
  out.push('', ASK[kind])
  return out.join('\n')
}

function nameIn(s: BotView['state'], view: BotView, instanceId: string): string {
  for (const z of s.zones) for (const c of [...z.cards.a, ...z.cards.b]) if (c.instanceId === instanceId) return c.name
  for (const c of s.activeBattle?.summons ?? []) if (c.instanceId === instanceId) return c.name
  for (const c of view.hand) if (c.instanceId === instanceId) return c.name
  return instanceId
}
