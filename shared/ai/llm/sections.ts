import type { GameAction } from '../../engine/engineTypes.ts'
import { TABLE_TALK_PREFIX } from './tableTalk.ts'

// The bot's turn runs in four sections, in this order (2026-09-18 sectioned
// bot turn spec §3.1). Every verified menu item belongs to one of them — or
// to none, for the one-move kinds — and the model is shown only the current
// section's items. `finish` shows deploy's items again, plus END TURN.
export type Section = 'deploy' | 'activate' | 'fight' | 'finish'
export const SECTION_ORDER: readonly Section[] = ['deploy', 'activate', 'fight', 'finish']

export function nextSection(section: Section): Section | null {
  const i = SECTION_ORDER.indexOf(section)
  return i >= 0 && i + 1 < SECTION_ORDER.length ? SECTION_ORDER[i + 1] : null
}

type HeroPower = Extract<GameAction, { type: 'USE_HERO_POWER' }>['power']
// Flanking Maneuver only sets up a fleet battle the bot starts this turn;
// Tactical Positioning is battle-time, and verification prunes it outside one.
const FIGHT_POWERS: ReadonlySet<HeroPower> = new Set<HeroPower>(['flankingManeuver', 'tacticalPositioning'])

// Exhaustive on purpose — no default, and the function must return — so a
// new action type fails to compile until it is placed: the compile-time half
// of the coverage pin. sections.test.ts is the runtime half.
export function sectionOf(action: GameAction): Section | null {
  switch (action.type) {
    case 'PLAY_CARD_TO_ZONE': case 'PLAY_ABILITY_CARD':
    case 'PLAY_CARD_TARGETING_CARD_ON_FIELD': case 'PLAY_CARD_TARGETING_CARD_IN_HAND':
    case 'MOVE_VEHICLE': case 'SET_ALERT_CARD':
      return 'deploy'
    case 'USE_HERO_POWER':
      return FIGHT_POWERS.has(action.power) ? 'fight' : 'deploy'
    case 'ACTIVATE_VEHICLE':
      return 'activate'
    case 'ATTACK_ENEMY_BASE': case 'ATTACK_ENEMY_FLEET':
      return 'fight'
    case 'END_TURN':
      return 'finish'
    case 'RESPOND_TO_ATTACK': case 'DECIDE_BATTLE_REPORT': case 'RESOLVE_PENDING_EFFECT':
    case 'CONCEDE': case 'ABANDON': case 'SUBMIT_BATTLE_REPORT':
      return null
  }
}

// Whether an item tagged `itemSection` is shown while the pointer is at `section`.
export const inSection = (itemSection: Section | null, section: Section): boolean =>
  section === 'finish' ? itemSection === 'deploy' || itemSection === 'finish' : itemSection === section

// Fixed driver lines under the table-talk prefix WITHOUT formatTableTalk's
// quotes (spec §3.5): the frontend's bubble and log styling key on the
// prefix, and the missing quotes tell a marker from a spoken line.
export const SECTION_MARKERS: Record<Section, string> = {
  deploy: `${TABLE_TALK_PREFIX}deploying…`,
  activate: `${TABLE_TALK_PREFIX}activating…`,
  fight: `${TABLE_TALK_PREFIX}fighting…`,
  finish: `${TABLE_TALK_PREFIX}finishing…`,
}
const MARKER_LINES: ReadonlySet<string> = new Set(Object.values(SECTION_MARKERS))
export const isSectionMarker = (line: string): boolean => MARKER_LINES.has(line)

// The section line that heads a turn call's menu, and the ask that closes it
// (spec §4.3). Prose only — a number here would rot against llmSettings.ts.
export const SECTION_LINES: Record<Section, string> = {
  deploy: 'SECTION: DEPLOY — play cards, use hero powers, move Mobile hulls, or reveal an alert card.',
  activate: "SECTION: ACTIVATE — use a hull's activated ability.",
  fight: 'SECTION: FIGHT — attack a base or declare a fleet battle; each zone at most once per turn; a fleet battle pauses your turn until the human reports it.',
  finish: 'SECTION: FINISH — last deploys or hero powers, then END TURN.',
}
export const SECTION_ASKS: Record<Section, string> = {
  deploy: 'Pick ONE move (its number), or [] if nothing here is worth doing. then: "continue" for another deploy move, "next" to go on to ACTIVATE.',
  activate: 'Pick ONE, or []. then: "continue" for another, "next" to go on to FIGHT.',
  fight: 'Pick ONE, or []. then: "continue" for another, "next" to go on to FINISH.',
  finish: 'Pick ONE, or [] to END TURN.',
}
