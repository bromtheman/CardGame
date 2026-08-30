import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { BattleContext, EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import {
  battleOutcome, canRevive, discardSnapshotOf, dispatchBaseAttackVictory, dispatchBattleLock,
  dispatchBattleResolve, reviveEntry, sacrificeEntry,
} from './index.ts'
import type { BattleParticipant } from './index.ts'
import { registerEffect } from '../effects/registry.ts'
import { choice } from '../effects/primitives.ts'
import { makeCtx, makeGame, zoneEntry } from './testFixtures.ts'

// Every spy records the context it was handed, so a test can assert not just
// "it fired" but "it fired with this phase / side / participation". Synthetic
// t_-prefixed names throughout — never a real seeded effect name, which would
// couple this file to a card's registration state (docs/claude/testing.md).
interface Fired { effect: string; card: string; actor: Side; battle: BattleContext | undefined }
let fired: Fired[] = []

function spy(name: string, opts?: { battleBystander?: boolean }, body?: () => boolean) {
  registerEffect(name, ({ card, actor, battle }) => {
    fired.push({ effect: name, card: card.name, actor, battle })
    return body ? body() : true
  }, opts)
}

beforeAll(() => {
  spy('t_lockSpy')
  spy('t_lockSpy2')
  spy('t_bystanderSpy', { battleBystander: true })
  spy('t_plainBystander') // registered WITHOUT the flag — must never fire as a bystander
  spy('t_riderSpy')
  spy('t_resolveSpy')
  spy('t_victorySpy')
  spy('t_defeatSpy')
  spy('t_failing', undefined, () => false)
  // A real choice(), so the one-slot rule is exercised where it actually
  // lives rather than through a hand-written pendingEffect write.
  registerEffect('t_chooser', choice({
    effect: 't_chooser',
    prompt: 'Pick one',
    options: () => [{ id: 'x', label: 'X' }],
    resolve: () => true,
  }))
  // Occupies the one suspension slot the way a real choice would, so the
  // "skips the rest" case is driven by the same state a card produces.
  registerEffect('t_suspender', ({ game, card, actor, battle }) => {
    fired.push({ effect: 't_suspender', card: card.name, actor, battle })
    game.state.pendingEffect = {
      effect: 't_suspender', side: actor, card, kind: 'choice',
      prompt: 'Pick one', options: [{ id: 'x', label: 'X' }],
    }
    return true
  })
})

beforeEach(() => { fired = [] })

const names = () => fired.map((f) => f.effect)

// A locked battle in zone 1: side a is the aggressor. Callers push whatever
// entries they need onto the zone first, then name the ids here.
function lock(
  game: EngineGame,
  spec: { attackerIds: string[]; defenderIds: string[]; summons?: ZoneCardEntry[] },
) {
  game.state.activeBattle = {
    zoneId: 1, aggressor: 'a',
    attackerIds: spec.attackerIds, defenderIds: spec.defenderIds,
    distanceM: 1200, distanceModifiedBy: [],
    summons: spec.summons ?? [], continuation: null,
  }
}

function trigger(name: string, over: Partial<ZoneCardEntry> = {}): ZoneCardEntry {
  return zoneEntry({ ...over, meta: { onBattleEffect: name, ...(over.meta ?? {}) } })
}

describe('battleOutcome', () => {
  function participants(entries: [ZoneCardEntry, Side][]): Map<string, BattleParticipant> {
    return new Map(entries.map(([entry, side]) => [entry.instanceId, { entry, side }]))
  }

  it('gives the win to the side whose enemy has no survivor', () => {
    const atk = zoneEntry({}); const def = zoneEntry({})
    const p = participants([[atk, 'a'], [def, 'b']])
    expect(battleOutcome(p, new Set([atk.instanceId]), 'a')).toMatchObject({ wonBy: { a: true, b: false } })
    expect(battleOutcome(p, new Set([def.instanceId]), 'a')).toMatchObject({ wonBy: { a: false, b: true } })
  })

  it('calls it a draw when both sides still hold a survivor', () => {
    const atk = zoneEntry({}); const def = zoneEntry({})
    const p = participants([[atk, 'a'], [def, 'b']])
    const out = battleOutcome(p, new Set([atk.instanceId, def.instanceId]), 'a')
    expect(out.wonBy).toEqual({ a: false, b: false })
  })

  // Spec §4.3, DP2 departure 6. A summon fought, so it counts for this test
  // even though it evaporates a moment later.
  it('counts a surviving summon as a participant, denying the enemy a win', () => {
    const atk = zoneEntry({}); const def = zoneEntry({}); const summon = zoneEntry({ name: 'Martyr' })
    const p = participants([[atk, 'a'], [def, 'b'], [summon, 'b']])
    const out = battleOutcome(p, new Set([atk.instanceId, summon.instanceId]), 'a')
    expect(out.wonBy.a).toBe(false)
    expect(out.survived.has(summon.instanceId)).toBe(true)
  })
})

describe('dispatchBattleLock', () => {
  it('fires for a participant on each side, with the right isDefender', () => {
    const g = makeGame()
    const atk = trigger('t_lockSpy'); const def = trigger('t_lockSpy2')
    g.state.zones[0].cards.a.push(atk); g.state.zones[0].cards.b.push(def)
    lock(g, { attackerIds: [atk.instanceId], defenderIds: [def.instanceId] })
    dispatchBattleLock(g, makeCtx(), false)
    expect(names()).toEqual(['t_lockSpy', 't_lockSpy2'])
    expect(fired[0].battle).toMatchObject({
      phase: 'lock', zoneId: 1, isDefender: false, isParticipant: true,
      forced: false, survived: false, won: false,
    })
    expect(fired[1].battle).toMatchObject({ isDefender: true, isParticipant: true })
    expect(fired[0].actor).toBe('a')
    expect(fired[1].actor).toBe('b')
  })

  it('fires for a summon listed in defenderIds', () => {
    const g = makeGame()
    const atk = zoneEntry({})
    const summon = trigger('t_lockSpy', { name: 'Summoned' })
    g.state.zones[0].cards.a.push(atk)
    lock(g, { attackerIds: [atk.instanceId], defenderIds: [summon.instanceId], summons: [summon] })
    dispatchBattleLock(g, makeCtx(), false)
    expect(fired).toHaveLength(1)
    expect(fired[0].card).toBe('Summoned')
    expect(fired[0].battle).toMatchObject({ isDefender: true, isParticipant: true })
  })

  it('never fires for a same-zone non-participant when the battle is not forced', () => {
    const g = makeGame()
    const atk = zoneEntry({}); const def = zoneEntry({})
    const bystander = trigger('t_bystanderSpy')
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def, bystander)
    lock(g, { attackerIds: [atk.instanceId], defenderIds: [def.instanceId] })
    dispatchBattleLock(g, makeCtx(), false)
    expect(names()).toEqual([])
  })

  it('fires for a defending-side bystander on a forced battle, with isParticipant false', () => {
    const g = makeGame()
    const atk = zoneEntry({}); const def = zoneEntry({})
    const bystander = trigger('t_bystanderSpy', { name: 'Bystander' })
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def, bystander)
    lock(g, { attackerIds: [atk.instanceId], defenderIds: [def.instanceId] })
    dispatchBattleLock(g, makeCtx(), true)
    expect(names()).toEqual(['t_bystanderSpy'])
    expect(fired[0].battle).toMatchObject({
      phase: 'lock', isParticipant: false, isDefender: true, forced: true,
    })
  })

  // Spec §4.3, DP2 departure 2: the flag is what keeps the other five DP2
  // cards out of the bystander pass entirely, so they need no isParticipant
  // guard of their own.
  it('ignores a non-participant whose effect is registered without the bystander flag', () => {
    const g = makeGame()
    const atk = zoneEntry({}); const def = zoneEntry({})
    const bystander = trigger('t_plainBystander')
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def, bystander)
    lock(g, { attackerIds: [atk.instanceId], defenderIds: [def.instanceId] })
    dispatchBattleLock(g, makeCtx(), true)
    expect(names()).toEqual([])
  })

  it('ignores a bystander on the aggressor side, and one in another zone', () => {
    const g = makeGame()
    const atk = zoneEntry({}); const def = zoneEntry({})
    g.state.zones[0].cards.a.push(atk, trigger('t_bystanderSpy', { name: 'WrongSide' }))
    g.state.zones[0].cards.b.push(def)
    g.state.zones[1].cards.b.push(trigger('t_bystanderSpy', { name: 'WrongZone' }))
    lock(g, { attackerIds: [atk.instanceId], defenderIds: [def.instanceId] })
    dispatchBattleLock(g, makeCtx(), true)
    expect(names()).toEqual([])
  })

  it('fires a zoneEffects rider for the defending side only', () => {
    const g = makeGame()
    const atk = zoneEntry({}); const def = zoneEntry({})
    g.state.zones[0].cards.a.push(atk); g.state.zones[0].cards.b.push(def)
    g.state.zoneEffects.push(
      { effect: 't_riderSpy', zoneId: 1, side: 'b', cardName: 'Rider', setOnTurn: 1 },
      { effect: 't_riderSpy', zoneId: 1, side: 'a', cardName: 'AggressorRider', setOnTurn: 1 },
      { effect: 't_riderSpy', zoneId: 2, side: 'b', cardName: 'OtherZoneRider', setOnTurn: 1 },
    )
    lock(g, { attackerIds: [atk.instanceId], defenderIds: [def.instanceId] })
    dispatchBattleLock(g, makeCtx({ catalog: [{ ...zoneEntry({ name: 'Rider' }) }] }), false)
    expect(fired.map((f) => f.card)).toEqual(['Rider'])
    expect(fired[0].actor).toBe('b')
    expect(fired[0].battle).toMatchObject({ phase: 'lock', isDefender: true, isParticipant: false })
  })

  it('skips a rider whose cardName is missing from the catalog, without failing', () => {
    const g = makeGame()
    const atk = zoneEntry({}); const def = zoneEntry({})
    g.state.zones[0].cards.a.push(atk); g.state.zones[0].cards.b.push(def)
    g.state.zoneEffects.push({ effect: 't_riderSpy', zoneId: 1, side: 'b', cardName: 'Nowhere', setOnTurn: 1 })
    lock(g, { attackerIds: [atk.instanceId], defenderIds: [def.instanceId] })
    expect(() => dispatchBattleLock(g, makeCtx(), false)).not.toThrow()
    expect(names()).toEqual([])
  })

  // Spec §4.3, DP2 departure 4. One slot, fixed order — but the enforcement
  // lives in choice(), not here: EVERY trigger still runs, so a card whose
  // text has an unconditional clause as well as an optional one still gets the
  // unconditional half. Only the second OFFER is dropped.
  it('keeps dispatching after the pending slot is taken, so unconditional halves still run', () => {
    const g = makeGame()
    const first = trigger('t_suspender', { name: 'Chooser' })
    const second = trigger('t_lockSpy', { name: 'Latecomer' })
    g.state.zones[0].cards.a.push(first, second)
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'd1' }))
    lock(g, { attackerIds: [first.instanceId, second.instanceId], defenderIds: ['d1'] })
    dispatchBattleLock(g, makeCtx(), false)
    expect(names()).toEqual(['t_suspender', 't_lockSpy'])
    expect(g.state.pendingEffect?.card.name).toBe('Chooser') // the first offer stands
  })

  it('drops a second offer rather than overwriting the first', () => {
    const g = makeGame()
    const first = trigger('t_chooser', { name: 'First' })
    const second = trigger('t_chooser', { name: 'Second' })
    g.state.zones[0].cards.a.push(first, second)
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'd1' }))
    lock(g, { attackerIds: [first.instanceId, second.instanceId], defenderIds: ['d1'] })
    dispatchBattleLock(g, makeCtx(), false)
    expect(g.state.pendingEffect?.card.name).toBe('First')
    expect(g.state.log.join('\n')).toContain("Second's offer was not made")
  })

  it('logs a note when a trigger reports failure, and keeps dispatching', () => {
    const g = makeGame()
    const bad = trigger('t_failing', { name: 'Broken' })
    const good = trigger('t_lockSpy', { name: 'Fine' })
    g.state.zones[0].cards.a.push(bad, good)
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'd1' }))
    lock(g, { attackerIds: [bad.instanceId, good.instanceId], defenderIds: ['d1'] })
    dispatchBattleLock(g, makeCtx(), false)
    expect(names()).toEqual(['t_failing', 't_lockSpy'])
    expect(g.state.log.join('\n')).toContain('Broken')
  })
})

describe('dispatchBattleResolve', () => {
  function resolved(winner: Side) {
    const g = makeGame()
    const atk = trigger('t_resolveSpy', { name: 'Attacker', meta: {
      onBattleEffect: 't_resolveSpy', onBattleVictory: 't_victorySpy', onBattleDefeat: 't_defeatSpy',
    } })
    const def = trigger('t_resolveSpy', { name: 'Defender', meta: {
      onBattleEffect: 't_resolveSpy', onBattleVictory: 't_victorySpy', onBattleDefeat: 't_defeatSpy',
    } })
    g.state.zones[0].cards.a.push(atk); g.state.zones[0].cards.b.push(def)
    const participants = new Map<string, BattleParticipant>([
      [atk.instanceId, { entry: atk, side: 'a' }],
      [def.instanceId, { entry: def, side: 'b' }],
    ])
    const survivors = new Set([winner === 'a' ? atk.instanceId : def.instanceId])
    const outcome = battleOutcome(participants, survivors, 'a')
    return { g, atk, def, participants, outcome }
  }

  it('sends victory only to the winner and defeat only to the loser', () => {
    const { g, participants, outcome } = resolved('a')
    dispatchBattleResolve(g, makeCtx(), 1, 'a', participants, outcome, [])
    const byCard = fired.map((f) => `${f.card}:${f.effect}`)
    expect(byCard).toContain('Attacker:t_victorySpy')
    expect(byCard).toContain('Defender:t_defeatSpy')
    expect(byCard).not.toContain('Attacker:t_defeatSpy')
    expect(byCard).not.toContain('Defender:t_victorySpy')
  })

  it('sends onBattleEffect to both sides, with per-participant survived', () => {
    const { g, participants, outcome } = resolved('a')
    dispatchBattleResolve(g, makeCtx(), 1, 'a', participants, outcome, [])
    const atkEffect = fired.find((f) => f.card === 'Attacker' && f.effect === 't_resolveSpy')
    const defEffect = fired.find((f) => f.card === 'Defender' && f.effect === 't_resolveSpy')
    expect(atkEffect?.battle).toMatchObject({ phase: 'resolve', survived: true, won: true, isDefender: false })
    expect(defEffect?.battle).toMatchObject({ phase: 'resolve', survived: false, won: false, isDefender: true })
  })
})

describe('dispatchBaseAttackVictory', () => {
  it('fires onBattleVictory for each striker, and nothing else', () => {
    const g = makeGame()
    const striker = zoneEntry({ name: 'Raider', meta: {
      onBattleVictory: 't_victorySpy', onBattleEffect: 't_lockSpy',
    } })
    g.state.zones[0].cards.a.push(striker)
    dispatchBaseAttackVictory(g, makeCtx(), 1, 'a', [striker])
    expect(names()).toEqual(['t_victorySpy'])
    expect(fired[0].battle).toMatchObject({
      phase: 'baseAttack', zoneId: 1, isDefender: false, isParticipant: true,
      forced: false, survived: true, won: true,
    })
  })
})

describe('reviveEntry', () => {
  it('returns the hull to the zone and removes exactly one matching snapshot', () => {
    const g = makeGame()
    const dead = zoneEntry({ name: 'Halberd' })
    // Two identical copies died; reviving one must leave the other in place.
    g.state.destroyed.a.push(discardSnapshotOf(dead, 'a'), discardSnapshotOf(dead, 'a'))
    expect(reviveEntry(g, 'a', dead, 1)).toBe(true)
    expect(g.state.zones[0].cards.a.map((c) => c.instanceId)).toEqual([dead.instanceId])
    expect(g.state.destroyed.a).toHaveLength(1)
  })

  it('files the revival against the zone the entry belongs to', () => {
    const g = makeGame()
    const dead = zoneEntry({ name: 'Halberd' })
    g.state.destroyed.b.push(discardSnapshotOf(dead, 'b'))
    expect(reviveEntry(g, 'b', dead, 2)).toBe(true)
    expect(g.state.zones[1].cards.b).toHaveLength(1)
    expect(g.state.zones[0].cards.b).toHaveLength(0)
  })

  it('refuses and mutates nothing when no snapshot matches', () => {
    const g = makeGame()
    const dead = zoneEntry({ name: 'Halberd' })
    const other = zoneEntry({ name: 'Jormangund' })
    g.state.destroyed.a.push(discardSnapshotOf(other, 'a'))
    expect(reviveEntry(g, 'a', dead, 1)).toBe(false)
    expect(g.state.zones[0].cards.a).toHaveLength(0)
    expect(g.state.destroyed.a).toHaveLength(1)
  })

  // A captured card's discard is filed under its owner (gameEngine.ownerSideOf),
  // so its revival must look there rather than under whoever was flying it.
  it('pulls a captured hull back out of its owner pile, not its controller pile', () => {
    const g = makeGame()
    const dead = zoneEntry({ name: 'Loaner', meta: { ownerSide: 'b' } })
    // discardCard strips ownerSide on the way home, so the pile holds the
    // stripped form — the revive has to rebuild the same derivation to match.
    g.state.destroyed.b.push(discardSnapshotOf(dead, 'a'))
    expect(reviveEntry(g, 'a', dead, 1)).toBe(true)
    expect(g.state.destroyed.b).toHaveLength(0)
    expect(g.state.zones[0].cards.a).toHaveLength(1)
  })

  // Two snapshots of one card are NOT interchangeable: repairmenReadyEffect
  // grants SCRAPPY to a hull already on the board, so a plain and a Scrappy
  // copy share a cardId and differ in exactly the field that decides whether
  // the owner gets a free upgrade back through reshuffleDiscard.
  it('revives the exact snapshot, not merely one with the same cardId', () => {
    const g = makeGame()
    const plain = zoneEntry({ name: 'Cyclone', cardId: 'cyclone' })
    const scrappy: typeof plain = { ...plain, instanceId: 'scrappy-1', keywords: ['scrappy'] }
    g.state.destroyed.a.push(discardSnapshotOf(plain, 'a'), discardSnapshotOf(scrappy, 'a'))
    expect(reviveEntry(g, 'a', scrappy, 1)).toBe(true)
    expect(g.state.zones[0].cards.a[0].keywords).toEqual(['scrappy'])
    // The plain copy is what must be left behind.
    expect(g.state.destroyed.a).toHaveLength(1)
    expect(g.state.destroyed.a[0].keywords).toEqual([])
  })

  it('canRevive agrees with reviveEntry, before and after the pile empties', () => {
    const g = makeGame()
    const dead = zoneEntry({ name: 'Halberd' })
    g.state.destroyed.a.push(discardSnapshotOf(dead, 'a'))
    expect(canRevive(g, 'a', dead)).toBe(true)
    // What a death trigger's draw does to the pile: reshuffleDiscard empties
    // the whole discard into the deck, and the casualty becomes unrevivable.
    g.state.destroyed.a = []
    expect(canRevive(g, 'a', dead)).toBe(false)
    expect(reviveEntry(g, 'a', dead, 1)).toBe(false)
  })
})

describe('sacrificeEntry', () => {
  it('takes the hull off the board and into its owner discard', () => {
    const g = makeGame()
    const hull = zoneEntry({ name: 'Sacrilego' })
    g.state.zones[0].cards.a.push(hull)
    expect(sacrificeEntry(g, 'a', hull.instanceId, 1)).toBe(true)
    expect(g.state.zones[0].cards.a).toEqual([])
    expect(g.state.destroyed.a.map((c) => c.name)).toEqual(['Sacrilego'])
  })

  // It routes through discardCard, so both of that function's rules hold: a
  // captured hull goes home rather than being confiscated…
  it('sends a captured hull home to its owner', () => {
    const g = makeGame()
    const hull = zoneEntry({ name: 'Loaner', meta: { ownerSide: 'b' } })
    g.state.zones[0].cards.a.push(hull)
    expect(sacrificeEntry(g, 'a', hull.instanceId, 1)).toBe(true)
    expect(g.state.destroyed.a).toEqual([])
    expect(g.state.destroyed.b.map((c) => c.name)).toEqual(['Loaner'])
    expect(g.state.destroyed.b[0].meta.ownerSide).toBeUndefined()
  })

  // …and a summon-only hull never reaches a discard at all, because that is a
  // deck's back door (spec §7.1).
  it('never files a summon-only hull into a discard', () => {
    const g = makeGame()
    const hull = zoneEntry({ name: 'Martyr', meta: { summonOnly: true } })
    g.state.zones[0].cards.a.push(hull)
    expect(sacrificeEntry(g, 'a', hull.instanceId, 1)).toBe(true)
    expect(g.state.zones[0].cards.a).toEqual([])
    expect(g.state.destroyed.a).toEqual([])
  })

  it('refuses and changes nothing when the hull is not where it was expected', () => {
    const g = makeGame()
    const hull = zoneEntry({ name: 'Sacrilego' })
    g.state.zones[0].cards.a.push(hull)
    expect(sacrificeEntry(g, 'b', hull.instanceId, 1)).toBe(false) // wrong side
    expect(sacrificeEntry(g, 'a', hull.instanceId, 2)).toBe(false) // wrong zone
    expect(sacrificeEntry(g, 'a', 'ghost', 1)).toBe(false)
    expect(g.state.zones[0].cards.a).toHaveLength(1)
    expect(g.state.destroyed.a).toEqual([])
  })
})
