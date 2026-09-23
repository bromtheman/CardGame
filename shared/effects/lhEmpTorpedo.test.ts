import { describe, expect, it } from 'vitest'
import { applyAction, chargeOf } from '../engine/index.ts'
import type { GameAction, ZoneCardEntry } from '../engine/engineTypes.ts'
import { inst, makeCtx, makeGame, zoneEntry } from '../engine/testFixtures.ts'

// The 2026-09-23 EMP Torpedo amendment
// (docs/superpowers/specs/2026-09-23-lh-emp-torpedo-design.md): "Discharge 2
// from a friendly LH vehicle: remove target enemy submarine in that zone from
// play." Driven through PLAY_CARD_TARGETING_CARD_ON_FIELD and
// RESOLVE_PENDING_EFFECT, so the engine's host validation, pip spend,
// activation stamp and rollback run together with the effect.

const lhGame = () => {
  const game = makeGame({ turnNumber: 4, activePlayer: 'alice' })
  game.state.factions = { a: 'LH', b: 'SS' }
  game.privates.a.hand = [inst({
    instanceId: 'torpedo', name: 'EMP Torpedo', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 100_000,
    meta: { playOnVehicleEffect: 'empTorpedoEffect', dischargeFrom: 2 },
  })]
  game.state.counts.a = { hand: 1, deck: 0 }
  return game
}
// The paying vehicle: a charged LH hull in zone 1.
const payer = (over: Parameters<typeof zoneEntry>[0] = {}) =>
  zoneEntry({ instanceId: 'payer', name: 'Ampere', faction: 'LH', meta: { chargeMax: 2 }, charge: 2, ...over })
const sub = (instanceId: string, over: Parameters<typeof zoneEntry>[0] = {}) =>
  zoneEntry({ instanceId, name: 'Wolin', faction: 'SS', vehicleType: 'sub', materialCost: 250_000, ...over })
const play = (game: ReturnType<typeof makeGame>) =>
  applyAction(game, 'alice', { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'torpedo', targetInstanceId: 'payer' } as GameAction, makeCtx())
const pick = (game: ReturnType<typeof makeGame>, choiceId: string) =>
  applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId } as GameAction, makeCtx())
const ok = (res: ReturnType<typeof applyAction>) => {
  if (!res.ok) throw new Error(res.error)
  return res.game
}
const offered = (game: ReturnType<typeof makeGame>) => game.state.pendingEffect?.options.map((o) => o.id)

describe('EMP Torpedo — empTorpedoEffect', () => {
  it('removes the chosen enemy sub into its owner\'s discard, spending two pips and the payer\'s activation', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(payer())
    game.state.zones[0].cards.b.push(sub('wolin'))
    const asked = ok(play(game))
    expect(offered(asked)).toEqual(['wolin'])
    const done = ok(pick(asked, 'wolin'))
    expect(done.state.zones[0].cards.b).toEqual([])
    expect(done.state.destroyed.b.map((c) => c.name)).toEqual(['Wolin'])
    const paid = done.state.zones[0].cards.a[0] as ZoneCardEntry
    expect(chargeOf(paid)).toBe(0)
    expect(paid.activatedOnTurn).toBe(4)
    expect(done.privates.a.hand).toEqual([])
    expect(done.state.resources.a.materials).toBe(0)
    expect(done.state.log).toContain('EMP Torpedo: Wolin is removed from play in zone 1')
  })

  // 2026-09-02 R-7: "remove from play" copies discardCard and never
  // destroyedEntries, so fireDeathEffect never sees the hull. javelinOnDeath
  // would draw its owner a card; the owner's deck must stay untouched.
  it('fires no death trigger — removal is not destruction', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(payer())
    game.state.zones[0].cards.b.push(sub('wolin', { meta: { onDeathEffect: 'javelinOnDeath' } }))
    game.privates.b.deck = [inst({ name: 'Consolation' })]
    game.state.counts.b.deck = 1
    const done = ok(pick(ok(play(game)), 'wolin'))
    expect(done.privates.b.hand).toEqual([])
    expect(done.state.counts.b.deck).toBe(1)
  })

  it('offers only submarines — an enemy ship and an enemy hovercraft in the lane are not offered', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(payer())
    game.state.zones[0].cards.b.push(
      zoneEntry({ instanceId: 'ship', vehicleType: 'ship' }),
      zoneEntry({ instanceId: 'hover', vehicleType: 'hover' }),
      sub('wolin'),
    )
    expect(offered(ok(play(game)))).toEqual(['wolin'])
  })

  it('offers only the paying vehicle\'s lane', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(payer())
    game.state.zones[0].cards.b.push(sub('near'))
    game.state.zones[1].cards.b.push(sub('far'))
    expect(offered(ok(play(game)))).toEqual(['near'])
  })

  it('offers a Stealthy sub — Stealthy only dodges fleet battles', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(payer())
    game.state.zones[0].cards.b.push(sub('dis', { name: 'Disemboweler', faction: 'WF', keywords: ['stealthy'] }))
    expect(offered(ok(play(game)))).toEqual(['dis'])
  })

  it('is refused, spending nothing, when the paying vehicle\'s lane holds no enemy sub', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(payer())
    game.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'ship', vehicleType: 'ship' }))
    game.state.zones[1].cards.b.push(sub('far'))
    expect(play(game)).toMatchObject({
      ok: false, status: 400, error: 'EMP Torpedo\'s effect could not resolve — check its target',
    })
    expect(chargeOf(game.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(2)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['EMP Torpedo'])
    expect(game.state.resources.a.materials).toBe(100_000)
  })

  it('a declined pick leaves the card and the pips spent (2026-09-21 §3.2)', () => {
    const game = lhGame()
    game.state.zones[0].cards.a.push(payer())
    game.state.zones[0].cards.b.push(sub('wolin'))
    const declined = ok(applyAction(ok(play(game)), 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true } as GameAction, makeCtx()))
    expect(declined.state.zones[0].cards.b.map((c) => c.instanceId)).toEqual(['wolin'])
    expect(chargeOf(declined.state.zones[0].cards.a[0] as ZoneCardEntry)).toBe(0)
    expect(declined.privates.a.hand).toEqual([])
  })

  // The shared Discharge-from path, pinned for this card. These two pass
  // before empTorpedoEffect exists: the engine refuses them ahead of any effect.
  it('refuses a payer with 1 charge, and one already activated this turn (R-20)', () => {
    const low = lhGame()
    low.state.zones[0].cards.a.push(payer({ charge: 1 }))
    low.state.zones[0].cards.b.push(sub('wolin'))
    expect(play(low)).toMatchObject({ ok: false, status: 400 })
    const used = lhGame()
    used.state.zones[0].cards.a.push(payer({ activatedOnTurn: 4 }))
    used.state.zones[0].cards.b.push(sub('wolin'))
    expect(play(used)).toMatchObject({ ok: false, status: 409 })
  })
})
