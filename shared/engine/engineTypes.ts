import type { CardInstance, PublicGameState, SnapshotCard } from './gameInit.ts'

export type Side = 'a' | 'b'

export interface EngineContext {
  rng: () => number
  newId: () => string
  catalog: SnapshotCard[]
}

export interface ZoneCardEntry extends CardInstance {
  playedOnTurn: number
  movedOnTurn: number | null
  // Half-turn number of the last ACTIVATE_VEHICLE on this hull, null if never.
  // Enforces once-per-turn for onActivate (spec §4.3, DP1).
  activatedOnTurn: number | null
}

export interface AwaitingResponse {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  targetIds: string[]      // full defender selection, incl. stealthy
  stealthyIds: string[]    // subset the defender may opt out
}

// The suspension for an effect waiting on a battle report, analogous to
// PendingEffect (gameInit.ts) but living on ActiveBattle instead: the choice
// freeze (state.pendingEffect) admits neither SUBMIT_BATTLE_REPORT nor
// DECIDE_BATTLE_REPORT, so a battle continuation cannot use that slot
// (spec §4.3, departure 3). DECIDE_BATTLE_REPORT re-enters `effect` by name
// after death triggers fire; activeBattle (and so this) is nulled right
// after.
export interface BattleContinuation {
  effect: string                    // registry name re-entered when the battle resolves
  side: Side
  card: CardInstance
  data?: Record<string, unknown>    // effect-owned continuation state
}

export interface ActiveBattle {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  defenderIds: string[]
  distanceM: number
  distanceModifiedBy: Side[] // per-player: each side may apply Tactical Positioning once
  // Combatants that exist only for this battle: never pushed to zone.cards,
  // and evaporate on report approval regardless of HP — no repair, no death
  // record, nothing sent to state.destroyed (spec §4.4).
  summons: ZoneCardEntry[]
  // Set when the effect that forced this battle wants to run again once it
  // resolves (e.g. Trebuchet's repeat). Null for an ordinary declared battle.
  continuation: BattleContinuation | null
}

export interface BattleReport {
  submittedBy: Side
  results: Record<string, number> // instanceId -> ending HP percent (0-100)
  repairs: string[]               // instanceIds their controllers will pay to repair
}

export interface PrivateState {
  hand: CardInstance[]
  deck: CardInstance[]
}

export interface EngineGame {
  id: string
  playerA: string
  playerB: string
  status: 'active' | 'complete' | 'abandoned'
  winnerId: string | null
  turnNumber: number
  activePlayer: string
  settings: { zones: { biome: string; baseHp: number }[] }
  state: PublicGameState
  privates: { a: PrivateState; b: PrivateState }
}

export type GameAction =
  | { type: 'END_TURN' }
  | { type: 'CONCEDE' }
  | { type: 'ABANDON' }
  | { type: 'PLAY_CARD_TO_ZONE'; instanceId: string; zoneId: number }
  | { type: 'PLAY_ABILITY_CARD'; instanceId: string }
  | { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD'; instanceId: string; targetInstanceId: string }
  | { type: 'PLAY_CARD_TARGETING_CARD_IN_HAND'; instanceId: string; targetInstanceId: string }
  | { type: 'MOVE_VEHICLE'; instanceId: string; zoneId: number }
  | { type: 'ACTIVATE_VEHICLE'; instanceId: string; targetInstanceId?: string; zoneId?: number }
  | { type: 'ATTACK_ENEMY_BASE'; zoneId: number }
  | { type: 'ATTACK_ENEMY_FLEET'; zoneId: number; attackerIds: string[]; targetIds: string[] }
  | { type: 'RESPOND_TO_ATTACK'; optOutIds: string[] }
  | { type: 'SUBMIT_BATTLE_REPORT'; results: Record<string, number>; repairs: string[] }
  | { type: 'DECIDE_BATTLE_REPORT'; approve: boolean; repairs?: string[] }
  | { type: 'SET_ALERT_CARD'; instanceId: string }
  | {
      type: 'USE_HERO_POWER'
      power:
        | 'salvage' | 'tacticalPositioning' | 'draw' | 'rapidRedeployment'
        | 'boardingParty' | 'changeOrder' | 'flyby'
      cardId?: string       // salvage: which destroyed card
      instanceId?: string   // rapidRedeployment/boardingParty(mine)/changeOrder/flyby: which card
      targetInstanceId?: string // boardingParty: the enemy ship being traded for
      zoneId?: number       // rapidRedeployment: destination
      distanceDeltaM?: number // tacticalPositioning: ±meters
    }
  | {
      type: 'RESOLVE_PENDING_EFFECT'
      choiceId?: string
      targetInstanceId?: string
      zoneId?: number
      cancel?: boolean
    }

export type ApplyResult = { ok: true; game: EngineGame } | { ok: false; status: number; error: string }
