import type { PublicGameState } from '@shared/engine/gameInit'
import type { Side } from '@shared/engine/engineTypes'
import { battleParticipants, effectiveMaterialCostOf, otherSide } from '@shared/engine/index'
import type { BattleTeamInput } from '@shared/customBattle'
import { CARD_TYPES } from '@shared/gameSettings'

/**
 * The two fleets of the active battle, shaped for `buildCustomBattle`.
 *
 * The roster comes from the engine's own `battleParticipants`, not a local
 * reconstruction — BattleOverlay learned that lesson the hard way in wave 7, when
 * a hand-written mirror silently dropped TG Duel's cross-zone hull.
 *
 * The aggressor comes first and is the team marked `isAttacker`, so its hulls
 * spawn turned around. Costs are the EFFECTIVE ones (HALF_COST applied), which is
 * what the overlay's spawn sheet shows — so the resources FtD hands each team are
 * the ones the players were already told they get.
 *
 * Requires `state.activeBattle`.
 */
export function battleTeams(state: PublicGameState): BattleTeamInput[] {
  const battle = state.activeBattle!
  const participants = [...battleParticipants(state).values()]
  const fleetOn = (side: Side) =>
    participants
      .filter((p) => p.side === side && p.entry.type === CARD_TYPES.VEHICLE)
      .map((p) => ({
        name: p.entry.name,
        faction: p.entry.faction,
        vehicleType: p.entry.vehicleType,
        materialCost: effectiveMaterialCostOf(p.entry),
      }))

  const defender = otherSide(battle.aggressor)
  return [
    {
      name: `${state.factions[battle.aggressor]} (attacking)`,
      cards: fleetOn(battle.aggressor),
      isAttacker: true,
    },
    {
      name: `${state.factions[defender]} (defending)`,
      cards: fleetOn(defender),
      isAttacker: false,
    },
  ]
}
