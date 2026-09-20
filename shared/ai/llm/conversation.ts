import type { OwedKind } from '../basicPolicy.ts'
import type { BotView } from '../botView.ts'
import { MENU_SCORE_WINDOW_TURNS } from './llmSettings.ts'
import { tempoTag, withinWindow } from './moveMenu.ts'
import type { MenuItem } from './moveMenu.ts'
import { ASK, boardBlock, handBlock, headerLines, kindBlock, logTail, resourcesLine } from './prompt.ts'
import { inSection, SECTION_ASKS, SECTION_LINES } from './sections.ts'
import type { Section } from './sections.ts'

// The user messages of the sectioned flow's conversation (2026-09-18
// sectioned bot turn spec §4.1–4.3), composed from prompt.ts's blocks so the
// two flows describe the board in the same words.

// The section's items renumbered from one for the model (ruling 4);
// items[i] is what the model's number i+1 means. A one-move kind (section
// null) shows the whole menu.
export interface Numbered { items: MenuItem[]; lines: string[] }

export function numberedMenu(menu: MenuItem[], section: Section | null, window: number = MENU_SCORE_WINDOW_TURNS): Numbered {
  const scoped = section === null ? [...menu] : menu.filter((m) => inSection(m.section, section))
  const items = section === null ? scoped : withinWindow(scoped, window)
  return { items, lines: items.map((m, i) => `#${i + 1}${tempoTag(m.score)} ${m.text}`) }
}

// The model's numbers → the items they name; unknown numbers are dropped
// (the policy treats an answer that named only unknowns as malformed).
export function itemsFor(numbered: Numbered, numbers: number[]): MenuItem[] {
  return numbers.map((n) => numbered.items[n - 1]).filter((m): m is MenuItem => m !== undefined)
}

function menuAndAsk(kind: OwedKind, section: Section | null, numbered: Numbered): string[] {
  const head = section ? [SECTION_LINES[section]] : []
  return [...head, 'MENU', ...numbered.lines, '', section ? SECTION_ASKS[section] : ASK[kind]]
}

export interface FirstMessageInput { view: BotView; kind: OwedKind; section: Section | null; numbered: Numbered }

// The request's first call: the whole situation, as the single flow writes it.
export function firstMessage({ view, kind, section, numbered }: FirstMessageInput): string {
  const out: string[] = [...headerLines(view, kind), '', ...boardBlock(view), '', ...handBlock(view)]
  const owed = kindBlock(view, kind)
  if (owed.length) out.push('', ...owed)
  const tail = logTail(view)
  if (tail.length) out.push('', ...tail)
  out.push('', ...menuAndAsk(kind, section, numbered))
  return out.join('\n')
}

export interface FollowUpInput extends FirstMessageInput {
  outcome: string   // what the engine really did with the last move, or the pass line
  board: boolean    // re-send BOARD: a section start
  hand: boolean     // re-send YOUR HAND: its contents changed
}

// Every later call: the outcome, the resources now, the board and hand only
// when due, the owed block, then the menu and ask.
export function followUpMessage({ view, kind, section, numbered, outcome, board, hand }: FollowUpInput): string {
  const cards = view.hand.length
  const out: string[] = [`OUTCOME: ${outcome}`, `NOW: ${resourcesLine(view, kind)} Hand: ${cards} card${cards === 1 ? '' : 's'}.`]
  if (board) out.push('', ...boardBlock(view))
  if (hand) out.push('', ...handBlock(view))
  const owed = kindBlock(view, kind)
  if (owed.length) out.push('', ...owed)
  out.push('', ...menuAndAsk(kind, section, numbered))
  return out.join('\n')
}
