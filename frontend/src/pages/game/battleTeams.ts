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
 * **The aggressor-first order is load-bearing**, not merely cosmetic: the FtD
 * mod reports a winning TEAM index, and `sideForTeamIndex` in
 * `shared/battleReport.ts` turns index 0 back into the aggressor's side on the
 * strength of this ordering. Swap these two and a reported win changes sides.
 *
 * Each card carries its `instanceId` and each team its `side`. That is what the
 * `.customBattle` file's `CardGame` block is built from — the mod knows a hull
 * only as (team index, vehicle index), and matching on NAME cannot work because
 * two copies of one ship collide. The block is built from this same array, so
 * the index pairing is structural rather than asserted (`buildCardGameBlock`).
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
        instanceId: p.entry.instanceId,
      }))

  const defender = otherSide(battle.aggressor)
  return [
    {
      name: `${state.factions[battle.aggressor]} (attacking)`,
      side: battle.aggressor,
      cards: fleetOn(battle.aggressor),
      isAttacker: true,
    },
    {
      name: `${state.factions[defender]} (defending)`,
      side: defender,
      cards: fleetOn(defender),
      isAttacker: false,
    },
  ]
}
