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
}

export interface AwaitingResponse {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  targetIds: string[]      // full defender selection, incl. stealthy
  stealthyIds: string[]    // subset the defender may opt out
}

export interface ActiveBattle {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  defenderIds: string[]
  distanceM: number
  distanceModifiedBy: Side[] // per-player: each side may apply Tactical Positioning once
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
  | { type: 'PLAY_CARD_TO_ZONE'; instanceId: string; zoneId: number }
  | { type: 'PLAY_ABILITY_CARD'; instanceId: string }
  | { type: 'MOVE_VEHICLE'; instanceId: string; zoneId: number }
  | { type: 'ATTACK_ENEMY_BASE'; zoneId: number }
  | { type: 'ATTACK_ENEMY_FLEET'; zoneId: number; attackerIds: string[]; targetIds: string[] }
  | { type: 'RESPOND_TO_ATTACK'; optOutIds: string[] }
  | { type: 'SUBMIT_BATTLE_REPORT'; results: Record<string, number>; repairs: string[] }
  | { type: 'DECIDE_BATTLE_REPORT'; approve: boolean }
  | {
      type: 'USE_HERO_POWER'
      power: 'salvage' | 'tacticalPositioning' | 'draw' | 'rapidRedeployment'
      cardId?: string       // salvage: which destroyed card
      instanceId?: string   // rapidRedeployment: which vehicle
      zoneId?: number       // rapidRedeployment: destination
      distanceDeltaM?: number // tacticalPositioning: ±meters
    }

export type ApplyResult = { ok: true; game: EngineGame } | { ok: false; status: number; error: string }
