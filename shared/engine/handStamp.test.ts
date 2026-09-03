import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyAction, discardSnapshotOf, drawCard, putInHand } from './index.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from './testFixtures.ts'
import { effectFor } from '../effects/registry.ts'
import { returnToHand } from './battleTriggers.ts'

const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('putInHand', () => {
  it('stamps the current turn and resyncs both public counts', () => {
    const game = makeGame({ turnNumber: 4.5 })
    game.privates.a.deck.push(inst({ name: 'Down there' }))
    putInHand(game, 'a', inst({ name: 'Arrival' }))
    expect(game.privates.a.hand[0].handEnteredTurn).toBe(4.5)
    expect(game.state.counts.a).toEqual({ hand: 1, deck: 1 })
  })

  // Re-entering a hand re-stamps. That is what makes the discount start over
  // for a card that was played, died, reshuffled and drawn again — and it is
  // also the only thing that repairs a card dealt before this deploy.
  it('re-stamps a card that enters a hand a second time', () => {
    const game = makeGame({ turnNumber: 2 })
    putInHand(game, 'a', inst({ handEnteredTurn: 1 }))
    expect(game.privates.a.hand[0].handEnteredTurn).toBe(2)
  })
})

describe('every hand-entry path stamps handEnteredTurn', () => {
  it('the initial deal', async () => {
    const { buildInitialGame } = await import('./gameInit.ts')
    const snapshots = new Map([['c1', snap({ cardId: 'c1' })]])
    let n = 0
    const built = buildInitialGame({
      gameId: 'g', playerA: 'alice', playerB: 'bob',
      settings: { zones: [{ biome: 'water', baseHp: 1000 }] },
      deckA: { cards: { c1: 6 }, snapshots }, deckB: { cards: { c1: 6 }, snapshots },
      instanceId: () => `i${n++}`, rng: () => 0.5, factionA: 'SS', factionB: 'SS',
    })
    for (const c of built.aPrivate.hand) expect(c.handEnteredTurn).toBe(1)
    for (const c of built.bPrivate.hand) expect(c.handEnteredTurn).toBe(1)
    // The DECK is deliberately unstamped — a card gets its stamp when it
    // reaches a hand, and drawCard is what does that.
    for (const c of built.aPrivate.deck) expect(c.handEnteredTurn).toBeUndefined()
  })

  it('drawCard', () => {
    const game = makeGame({ turnNumber: 3 })
    game.privates.a.deck.push(inst({ name: 'Top' }))
    drawCard(game, 'a', makeCtx())
    expect(game.privates.a.hand[0].handEnteredTurn).toBe(3)
  })

  it('drawFromPool, from the catalog', () => {
    const game = makeGame({ turnNumber: 2.5 })
    const ok = effectFor('reservesEffect')!({
      game, actor: 'a', card: inst(),
      ctx: makeCtx({ catalog: [snap({ name: 'R1', faction: 'DWG' })] }),
    })
    expect(ok).toBe(true)
    expect(game.privates.a.hand.every((c) => c.handEnteredTurn === 2.5)).toBe(true)
  })

  it('takeFromEnemyDeck', () => {
    const game = makeGame({ turnNumber: 5 })
    game.privates.b.deck.push(inst({ name: 'Theirs' }))
    expect(effectFor('paddlegunEffect')!({ game, actor: 'a', card: inst(), ctx: makeCtx() })).toBe(true)
    expect(game.privates.a.hand[0].handEnteredTurn).toBe(5)
  })

  it('the salvage hero power', () => {
    const game = makeGame({ turnNumber: 6 })
    game.state.resources.a.cp = 3
    game.state.destroyed.a.push(snap({ cardId: 'dead', type: 'vehicle' }))
    const r = applyAction(game, 'alice', { type: 'USE_HERO_POWER', power: 'salvage', cardId: 'dead' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.game.privates.a.hand[0].handEnteredTurn).toBe(6)
  })

  it('returnToHand', () => {
    const game = makeGame({ turnNumber: 7 })
    const entry = zoneEntry({ name: 'Nostalgia' })
    game.state.destroyed.a.push(discardSnapshotOf(entry))
    expect(returnToHand(game, 'a', entry, makeCtx())).toBe(true)
    expect(game.privates.a.hand[0].handEnteredTurn).toBe(7)
  })
})

describe('the stamp does not leak out of a hand', () => {
  // The snapshot-destructure trap (docs/claude/architecture.md). handEnteredTurn
  // is a new field on CardInstance, so ZoneCardEntry inherits it and a rest
  // spread swallows it in silence — into state.destroyed, and from there
  // through reshuffleDiscard into a DECK.
  it('discardSnapshotOf strips handEnteredTurn', () => {
    const snapshot = discardSnapshotOf(zoneEntry({ handEnteredTurn: 2 }))
    expect('handEnteredTurn' in snapshot).toBe(false)
  })
})

describe('there is exactly one way into a hand', () => {
  // The risk spec §4.2 names is a hand-entry path that FORGETS to stamp: it
  // yields a Tyr that is silently never discounted, with every test above
  // green. A unit test cannot see a path that does not exist yet — so this
  // reads the source instead, the way functionSharedSync.test.ts does, and
  // fails the build the moment someone writes a twelfth push.
  it('no production module outside gameEngine.ts pushes to a hand', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!e.name.endsWith('.ts') || e.name.endsWith('.test.ts')) continue
        if (p.endsWith(join('engine', 'gameEngine.ts'))) continue
        if (/hand\.push\(/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(SHARED)
    expect(offenders).toEqual([])
  })
})
