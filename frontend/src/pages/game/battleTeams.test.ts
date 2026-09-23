import { describe, expect, it } from 'vitest'
import type { PublicGameState } from '@shared/engine/gameInit'
import type { ZoneCardEntry } from '@shared/engine/engineTypes'
import { makeGame, zoneEntry } from '@shared/engine/testFixtures'
import { CARD_TYPES, KEYWORDS, VEHICLE_TYPES } from '@shared/gameSettings'

import { buildCustomBattle, resolveBlueprintPath } from '@shared/customBattle'
import type { BattleCard } from '@shared/customBattle'

import { battleTeams, heldInFtdIds } from './battleTeams'

// Zone 1, side a attacking. Extra hulls are appended to the roster by id, which
// is what decides membership — see battleParticipants.
function battleState(extra: { a?: ZoneCardEntry[]; b?: ZoneCardEntry[]; summons?: ZoneCardEntry[] } = {}) {
  const g = makeGame()
  const raider = zoneEntry({
    name: 'Marauder', faction: 'DWG', vehicleType: VEHICLE_TYPES.SHIP, materialCost: 100_000,
  })
  const bomber = zoneEntry({
    name: 'Monsoon', faction: 'GT', vehicleType: VEHICLE_TYPES.AIRSHIP, materialCost: 60_000,
  })
  const bastion = zoneEntry({
    name: 'Bulwark', faction: 'OW', vehicleType: VEHICLE_TYPES.SHIP, materialCost: 80_000,
  })
  g.state.zones[0]!.cards.a.push(raider, bomber, ...(extra.a ?? []))
  g.state.zones[0]!.cards.b.push(bastion, ...(extra.b ?? []))
  g.state.activeBattle = {
    zoneId: 1,
    aggressor: 'a',
    attackerIds: [raider.instanceId, bomber.instanceId, ...(extra.a ?? []).map((e) => e.instanceId),
      ...(extra.summons ?? []).map((e) => e.instanceId)],
    defenderIds: [bastion.instanceId, ...(extra.b ?? []).map((e) => e.instanceId)],
    distanceM: 1200,
    distanceModifiedBy: [],
    summons: extra.summons ?? [],
    continuation: null,
  }
  return g.state as PublicGameState
}

// The game row's turn_number, which PublicGameState does not carry — so
// battleTeams is handed it. makeGame's turn.
const TURN = 2

// Three defenders stunned on TURN (stamped TURN + 1): a ship the FtD battle
// holds still, and a plane and a hovercraft it lets fight normally — the hover
// stays stunned on the board, it just is not held in FtD. Bulwark is not stunned.
const withStunnedDefenders = () => battleState({
  b: [
    zoneEntry({
      instanceId: 'anchor', name: 'Anchor', faction: 'OW', vehicleType: VEHICLE_TYPES.SHIP, stunnedUntilTurn: 3,
    }),
    zoneEntry({
      instanceId: 'gull', name: 'Gull', faction: 'OW', vehicleType: VEHICLE_TYPES.PLANE, stunnedUntilTurn: 3,
    }),
    zoneEntry({
      instanceId: 'watt', name: 'Watt', faction: 'LH', vehicleType: VEHICLE_TYPES.HOVER, stunnedUntilTurn: 3,
    }),
  ],
})

const namesOf = (cards: { name: string }[]) => cards.map((c) => c.name).sort()

describe('battleTeams', () => {
  it('puts the aggressor first and marks only it the attacker', () => {
    const [attacking, defending] = battleTeams(battleState(), TURN)
    expect(attacking!.isAttacker).toBe(true)
    expect(defending!.isAttacker).toBe(false)
  })

  it('names each side by its faction and role', () => {
    const [attacking, defending] = battleTeams(battleState(), TURN)
    expect(attacking!.name).toBe('DWG (attacking)')
    expect(defending!.name).toBe('OW (defending)')
  })

  it('carries each hull name, faction and vehicle type through', () => {
    const [attacking] = battleTeams(battleState(), TURN)
    expect(attacking!.cards).toContainEqual(
      expect.objectContaining({ name: 'Monsoon', faction: 'GT', vehicleType: VEHICLE_TYPES.AIRSHIP }),
    )
  })

  it('sends the effective material cost, halving a Half Cost hull as the spawn sheet does', () => {
    const state = battleState()
    const [attacking] = battleTeams(state, TURN)
    expect(attacking!.cards.find((c) => c.name === 'Marauder')!.materialCost).toBe(100_000)

    const halved = battleState({
      a: [zoneEntry({ name: 'Cheap', materialCost: 90_000, keywords: [KEYWORDS.HALF_COST] })],
    })
    const [withHalfCost] = battleTeams(halved, TURN)
    expect(withHalfCost!.cards.find((c) => c.name === 'Cheap')!.materialCost).toBe(45_000)
  })

  it('leaves ability cards out of the fleet', () => {
    const state = battleState({
      a: [zoneEntry({ name: 'Broadside', type: CARD_TYPES.ABILITY, vehicleType: null })],
    })
    const [attacking] = battleTeams(state, TURN)
    expect(namesOf(attacking!.cards)).toEqual(['Marauder', 'Monsoon'])
  })

  it('includes a battle summon on the side that brought it', () => {
    const state = battleState({
      summons: [zoneEntry({ name: 'Flying Squirrel', faction: 'DWG', materialCost: 10_000 })],
    })
    const [attacking] = battleTeams(state, TURN)
    expect(namesOf(attacking!.cards)).toEqual(['Flying Squirrel', 'Marauder', 'Monsoon'])
  })
})

describe('the identity battleTeams hands the FtD mod', () => {
  it('stamps each team with its card-game side', () => {
    const [attacking, defending] = battleTeams(battleState(), TURN)
    expect(attacking!.side).toBe('a')
    expect(defending!.side).toBe('b')
  })

  it('carries every hull instanceId, which is how the mod names a vehicle', () => {
    const state = battleState()
    const ids = battleTeams(state, TURN).flatMap((t) => t.cards.map((c) => c.instanceId))
    expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true)
    // Distinct per hull — the whole reason the mod cannot match on name.
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives a summon an instanceId too, so a spawned hull can be reported', () => {
    const state = battleState({
      summons: [zoneEntry({ name: 'Flying Squirrel', faction: 'DWG', materialCost: 10_000 })],
    })
    const [attacking] = battleTeams(state, TURN)
    const squirrel = attacking!.cards.find((c) => c.name === 'Flying Squirrel')!
    expect(squirrel.instanceId).toBeTruthy()
  })

  // The end-to-end pairing the mod depends on, across both modules: what
  // battleTeams produces, buildCustomBattle must lay out so that
  // CardGame.Teams[i].Vehicles[j] describes Teams[i].Blueprints[j]. A filter
  // applied to one list and not the other would break this and nothing else.
  it('produces a battle file whose CardGame block lines up with its Blueprints', () => {
    const state = battleState({
      a: [zoneEntry({ name: 'Broadside', type: CARD_TYPES.ABILITY, vehicleType: null })],
      summons: [zoneEntry({ name: 'Flying Squirrel', faction: 'DWG', materialCost: 10_000 })],
    })
    const teams = battleTeams(state, TURN)
    const file = buildCustomBattle(teams, {
      cardGame: {
        endpoint: 'https://example.supabase.co/functions/v1/battle-report',
        gameId: 'g-1', zoneId: 1, battleKey: 'k', token: 't',
      },
    })
    const block = file.CardGame!
    expect(block.Teams.map((t) => t.Side)).toEqual(['a', 'b'])
    file.Teams.forEach((team, i) => {
      expect(block.Teams[i]!.Vehicles).toHaveLength(team.Blueprints.length)
      team.Blueprints.forEach((bp, j) => {
        const card = teams[i]!.cards[j]!
        expect(bp.FileName).toBe(resolveBlueprintPath(card))
        expect(block.Teams[i]!.Vehicles[j]!.InstanceId).toBe(card.instanceId)
        expect(block.Teams[i]!.Vehicles[j]!.Name).toBe(card.name)
      })
    })
    // The ability card is in neither list — dropped once, from the one array
    // that feeds both.
    expect(block.Teams.flatMap((t) => t.Vehicles).map((v) => v.Name)).not.toContain('Broadside')
  })
})


// Wave 8 — WF Ambush. The engine records the ambusher on the battle; this is
// where that becomes a facing in the generated FtD file.
describe('battleTeams — an ambushed fleet spawns facing away', () => {
  it('leaves facesAway unset on an ordinary battle', () => {
    const [attacking, defending] = battleTeams(battleState(), TURN)
    expect(attacking!.facesAway).toBeUndefined()
    expect(defending!.facesAway).toBeUndefined()
  })

  it('turns the ambushed fleet around and leaves the ambusher pointed at it', () => {
    const state = battleState()
    state.activeBattle!.ambushedBy = 'a'
    const [attacking, defending] = battleTeams(state, TURN)
    expect(attacking!.facesAway).toBe(false)
    expect(defending!.facesAway).toBe(true)
  })

  // The ambusher is always the aggressor (ambushSpring refuses on defence),
  // but the mapping is written off `ambushedBy` rather than assuming it, so a
  // later card that ambushes on defence needs no change here.
  it('reads the recorded side rather than assuming the aggressor', () => {
    const state = battleState()
    state.activeBattle!.ambushedBy = 'b'
    const [attacking, defending] = battleTeams(state, TURN)
    expect(attacking!.facesAway).toBe(true)
    expect(defending!.facesAway).toBe(false)
  })

  it('reaches the built battle file as a flipped SpawnAngle', () => {
    const state = battleState()
    state.activeBattle!.ambushedBy = 'a'
    const file = buildCustomBattle(battleTeams(state, TURN))
    expect(file.Teams[0]!.Blueprints[0]!.SpawnAngle).toBe(0)
    expect(file.Teams[1]!.Blueprints[0]!.SpawnAngle).toBe(180)
  })
})

// 2026-09-23: a stunned ship, tank or sub is held still in FtD — the mod turns
// its movement AI off for the whole fight while its weapons keep firing.
describe('battleTeams — stunned hulls held still in FtD (2026-09-23)', () => {
  const flagOf = (cards: BattleCard[], name: string) => cards.find((c) => c.name === name)!.stunned

  it('flags a stunned defending ship, and not a stunned defending plane or hovercraft', () => {
    const [, defending] = battleTeams(withStunnedDefenders(), TURN)
    expect(flagOf(defending!.cards, 'Anchor')).toBe(true)
    expect(flagOf(defending!.cards, 'Gull')).toBe(false)
    expect(flagOf(defending!.cards, 'Watt')).toBe(false)
    expect(flagOf(defending!.cards, 'Bulwark')).toBe(false)
  })

  it('reads the turn it is handed: a stun expiring this turn holds nothing', () => {
    const [, defending] = battleTeams(withStunnedDefenders(), TURN + 1)
    expect(defending!.cards.map((c) => c.stunned)).toEqual([false, false, false, false])
  })

  // The hover and the plane are stunned on the board all the same; only the
  // .customBattle leaves them free to fight.
  it('reaches the built battle file as Stunned on that ship alone, never the hovercraft', () => {
    const file = buildCustomBattle(battleTeams(withStunnedDefenders(), TURN), {
      cardGame: {
        endpoint: 'https://example.supabase.co/functions/v1/battle-report',
        gameId: 'g-1', zoneId: 1, battleKey: 'k', token: 't',
      },
    })
    const held = file.CardGame!.Teams.flatMap((t) => t.Vehicles).filter((v) => v.Stunned)
    expect(held).toEqual([{ InstanceId: 'anchor', Name: 'Anchor', Stunned: true }])
  })

  // The spawn sheet's "held still in FtD" marker is read off these same flags.
  it('marks the held hull for the spawn sheet, and no other', () => {
    expect([...heldInFtdIds(battleTeams(withStunnedDefenders(), TURN))]).toEqual(['anchor'])
  })
})
