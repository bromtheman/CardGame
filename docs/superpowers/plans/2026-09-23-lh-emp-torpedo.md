# LH EMP Torpedo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship EMP Torpedo, a new LH ability that spends 2 charge from a friendly LH vehicle to remove an enemy submarine in that vehicle's lane. It is LH's answer to a sub locking down a lane.

**Architecture:**
- **The card.** One new registry effect, `empTorpedoEffect`, in `shared/effects/lhEffects.ts`. It combines EMP Salvo's second pick, filtered to submarines, with WF Sub Strike's removal body. The engine's existing Discharge-from path (`PLAY_CARD_TARGETING_CARD_ON_FIELD`) already validates the paying vehicle, spends the pips and stamps its activation, so no engine file changes.
- **Data.** One new seed row, generated into `seed_data.sql` by `seed:build` and copied into the edge functions by `functions:sync`.
- **PracticeAI.** One bot-deck swap and one strategy-notes line.

**Tech Stack:** TypeScript (strict), Vitest, the pure-TS engine in `shared/`, the JS seed source in `supabase/seed/source/`, Supabase edge functions (Deno) fed by `functions:sync`.

**Spec:** `docs/superpowers/specs/2026-09-23-lh-emp-torpedo-design.md` (amends `docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md`). Read both before starting.

## Global Constraints

- Card text, verbatim: `Discharge 2 from a friendly LH vehicle: remove target enemy submarine in that zone from play.`
- Card data: `name: 'EMP Torpedo'`, `type: 'ability'`, `vehicleType: null`, `faction: FACTIONS.LH`, `materialCost: 100000`, `blueprintCost: 0`, `cpCost: 0`, `imageUrl: 'empTorpedo.png'`, `meta: { [TRIGGERS.PLAY_ON_VEHICLE]: 'empTorpedoEffect', dischargeFrom: 2 }`.
- Registry id `empTorpedoEffect`, its own. Never reuse `subStrikeEffect` or any other card's id (the Kraken/Paddlegun rule, `docs/claude/card-effects.md`).
- The target test is `vehicleType === VEHICLE_TYPES.SUB` exactly. A hovercraft (`'hover'`) is a ship in every rule and is never offered.
- Removal goes through `discardCard` and never through destruction, so no `onDeathEffect` fires (2026-09-02 R-7).
- No change to the engine (only `lhEffects.ts`), to the frontend or to `gameSettings`.
- No new hand state: the owner ruled against a sub-in-lane check in `HandBar`.
- **Every commit touching `shared/` includes `npm run functions:sync` output** (CLAUDE.md hard rule; `supabase/seed/functionSharedSync.test.ts` fails otherwise).
- Every commit touching `supabase/seed/source/` includes the regenerated `supabase/seed/seed_data.sql` (`npm run seed:build`; `seedDataSync.test.ts` fails otherwise).
- Relative imports inside `shared/` carry the `.ts` extension.
- Tests import the engine through `shared/engine/index.ts`, never through individual engine modules.
- Shell is **PowerShell**: no `&&`, so use `;` or separate commands.
- Never pass `--root` to vitest: it silently runs 0 tests.
- **Do not run self-play evals or probes.** The owner's PC overheats, and the spec says the owner tests live.
- Commit messages end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or your own model's name if you are a different model). Pass it as a second `-m`.
- Work in the worktree `C:\Users\JFinn\FtDCardGame\.claude\worktrees\lh-submarine-solution-ee8476` on branch `claude/lh-submarine-solution-ee8476`. The spec is already committed there (`2b1301f`).

## File map

| File | Change | Responsibility |
|---|---|---|
| `shared/effects/lhEmpTorpedo.test.ts` | Create | Engine tests for the card, driven through real actions |
| `shared/effects/lhEffects.ts` | Modify | Import `discardCard`; add `empTorpedoEffect` after EMP Salvo |
| `shared/ai/evaluator.test.ts` | Modify | One test: the scored flow ranks the torpedo above END TURN |
| `supabase/seed/source/builtInCards/LH-Built-in.js` | Modify | The card's row, after Feedback Loop |
| `supabase/seed/balance/lh.balance.test.ts` | Modify | Pin the row by value; the roster counts go 30 → 31 and 40 → 41 |
| `supabase/seed/seed_data.sql` | Regenerate | `npm run seed:build` (195 cards) |
| `shared/ai/llm/factionNotes.ts` | Modify | The LH submarine line names EMP Torpedo; add to `mentions` |
| `shared/ai/botDecks.ts` | Modify | LH deck: Chrysoprase ×2 → ×1, plus EMP Torpedo ×1 |
| `supabase/functions/{game-action,lobby-action}/shared/…` | Regenerate | `npm run functions:sync` (lhEffects, botDecks, factionNotes) |

---

### Task 1: EMP Torpedo — the effect, its seed row and its tests

The effect and its seed row land together. The coverage guard's G4 fails on a registered effect that no seeded card names, and G1 fails on a seeded name with no implementation.

**Files:**
- Create: `shared/effects/lhEmpTorpedo.test.ts`
- Modify: `shared/ai/evaluator.test.ts` (append one `describe` block at the end of the file)
- Modify: `shared/effects/lhEffects.ts:15` (the import), and insert after the EMP Salvo block (currently ending at line 663, before `// Overcharge —`)
- Modify: `supabase/seed/source/builtInCards/LH-Built-in.js` (a new object after the Feedback Loop object, before the closing `];`)
- Modify: `supabase/seed/balance/lh.balance.test.ts` (a `CARDS` entry after `'LH:Feedback Loop'`, and the roster-shape test)
- Regenerate: `supabase/seed/seed_data.sql`, `supabase/functions/game-action/shared/effects/lhEffects.ts`, `supabase/functions/lobby-action/shared/effects/lhEffects.ts`

**Interfaces:**
- Consumes (existing, unchanged):
  - `choice`, `enemyVehicleOptions` from `shared/effects/primitives.ts`;
  - `hostLane(game, targetInstanceId)`, local to `lhEffects.ts`, defined just above EMP Salvo;
  - `findVehicle`, `otherSide`, `discardCard(game, controller, card)` from `shared/engine/gameEngine.ts`;
  - `VEHICLE_TYPES.SUB === 'sub'`.
- Produces: the registry id `empTorpedoEffect`, and the seed card `LH:EMP Torpedo`. Task 2 names that card in the bot deck and the notes.

- [ ] **Step 0: Prepare the worktree and record the baseline**

A fresh worktree has no `node_modules` and no env files (CLAUDE.md, "Worktree / environment setup"). Run from the worktree root:

```powershell
npm install
npm --prefix frontend install
Copy-Item ..\..\..\frontend\.env.local frontend\.env.local
Copy-Item ..\..\..\.env.local .env.local
npx vitest run
```

Record the final `Tests  N passed` line; it is the "before" count reported in Task 3. If the typecheck or the suite reports errors in the hundreds, suspect an incomplete install before suspecting the code. Both `.env.local` files are gitignored; never commit them.

- [ ] **Step 1: Write the failing engine tests**

Create `shared/effects/lhEmpTorpedo.test.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing evaluator test**

Append this block at the very end of `shared/ai/evaluator.test.ts`, after the closing `})` of the last `describe`. Every name it uses (`BOT`, `hull`, `inst`, `makeGame`, `makeCtx`, `KEYWORDS`, `scoreMove`) is already defined or imported at the top of that file.

```ts
// 2026-09-23 EMP Torpedo: a charged LH hull beside a Blocker sub. Removing the
// sub reopens the lane to bombardment, so the scored flow must rank the
// torpedo above ending the turn — PracticeAI finds LH's answer to a locked lane.
describe('scoreMove — EMP Torpedo', () => {
  it('scores the torpedo on a Blocker sub above END TURN', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({
      instanceId: 'torpedo', name: 'EMP Torpedo', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 100000,
      meta: { playOnVehicleEffect: 'empTorpedoEffect', dischargeFrom: 2 },
    })], deck: [] } } })
    g.state.factions = { a: 'TG', b: 'LH' }
    g.state.resources.b.materials = 100000
    g.state.zones[0].cards.b.push(hull(200000, { instanceId: 'ampere', name: 'Ampere', faction: 'LH', meta: { chargeMax: 2 }, charge: 2, playedOnTurn: 1 }))
    g.state.zones[0].cards.a.push(hull(375000, { instanceId: 'agony', name: 'Agony', faction: 'TG', vehicleType: 'sub', keywords: [KEYWORDS.BLOCKER] }))
    const end = scoreMove(g, BOT, { type: 'END_TURN' }, makeCtx(), 1)!
    const torpedo = scoreMove(g, BOT, { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'torpedo', targetInstanceId: 'ampere' }, makeCtx(), 1)!
    expect(torpedo).toBeGreaterThan(end)
  })
})
```

- [ ] **Step 3: Run the new tests and confirm they fail for the right reason**

```powershell
npx vitest run shared/effects/lhEmpTorpedo.test.ts shared/ai/evaluator.test.ts
```

Expected: **FAIL**, with seven of the eight `lhEmpTorpedo` tests failing:
- `empTorpedoEffect` is not registered yet, so the play resolves as a no-op;
- `pendingEffect` is null, so `offered(...)` is `undefined`;
- the "refused" test sees `ok: true`;
- the declined test throws "Nothing is waiting on a choice" (409).

The eighth test ("refuses a payer with 1 charge…") **passes already**; it pins the shared path. In `evaluator.test.ts`, "scores the torpedo on a Blocker sub above END TURN" fails, because the torpedo spends a card and pips for nothing and scores below END TURN. Every other evaluator test passes.

If the failures are different (an import error, or a fixture typo), fix the test before going on.

- [ ] **Step 4: Implement `empTorpedoEffect`**

In `shared/effects/lhEffects.ts`, add `discardCard` to the `gameEngine.ts` import on line 15:

```ts
import { discardCard, findVehicle, grantKeywordsTo, otherSide, putInHand, revokeKeywordsFrom, zoneById } from '../engine/gameEngine.ts'
```

The comment above `hostLane` opens with `// The three "Discharge 2 from a friendly LH vehicle" abilities (spec §3.2,`. That count is stale once this card lands, so change the first line to:

```ts
// The "Discharge 2 from a friendly LH vehicle" abilities that make a second pick (spec §3.2,
```

Then insert this block directly after EMP Salvo's closing `}))`, before the `// Overcharge —` comment:

```ts
// EMP Torpedo — "Discharge 2 from a friendly LH vehicle: remove target enemy
// submarine in that zone from play." (2026-09-23 EMP Torpedo amendment.)
// EMP Salvo's second pick narrowed to submarines, resolving with WF Sub
// Strike's removal body — under its OWN registry id, never subStrikeEffect's
// (the Kraken/Paddlegun rule, docs/claude/card-effects.md).
//
// ⚠ REMOVE FROM PLAY IS NOT DESTROY (2026-09-02 R-7): the sub leaves through
// discardCard, the single exit out of play, and is never pushed to
// destroyedEntries, so no onDeathEffect fires. `vehicleType === SUB` exactly:
// a hovercraft is a ship in every rule and is never offered. Stealthy subs
// are fair game — Stealthy only withdraws a defender from a fleet battle.
const EMP_TORPEDO = 'empTorpedoEffect'
const isSub = (e: ZoneCardEntry): boolean => e.vehicleType === VEHICLE_TYPES.SUB
registerEffect(EMP_TORPEDO, choice({
  effect: EMP_TORPEDO,
  prompt: 'EMP Torpedo — choose an enemy submarine in that zone to remove',
  options: ({ game, actor, targetInstanceId }) => {
    const host = hostLane(game, targetInstanceId)
    return host ? enemyVehicleOptions(game, actor, host.zone.id, isSub) : []
  },
  resolve: ({ game, actor, card }, choiceId) => {
    if (choiceId === null) return false
    // choice() has already checked choiceId was offered; re-check the board in
    // case the sub left it while the choice sat open.
    const found = findVehicle(game.state, choiceId)
    if (!found || found.side !== otherSide(actor) || !isSub(found.entry as ZoneCardEntry)) return false
    const enemy = found.side
    found.zone.cards[enemy] = found.zone.cards[enemy].filter((c) => c.instanceId !== choiceId)
    discardCard(game, enemy, found.entry)
    // The sub was public on the board a moment ago, so naming it leaks nothing.
    game.state.log.push(`${card.name}: ${found.entry.name} is removed from play in zone ${found.zone.id}`)
    return true
  },
}))
```

- [ ] **Step 5: Run the new tests and confirm they pass**

```powershell
npx vitest run shared/effects/lhEmpTorpedo.test.ts shared/ai/evaluator.test.ts
```

Expected: **PASS**, all eight `lhEmpTorpedo` tests and every evaluator test. (The coverage guard is not part of this run. It fails with a G4 orphan until Step 6 seeds the card.)

- [ ] **Step 6: Seed the card and pin it by value**

In `supabase/seed/source/builtInCards/LH-Built-in.js`, add this object after the Feedback Loop object, before the closing `];`:

```js
    {
        // 2026-09-23 EMP Torpedo amendment: LH's answer to a submarine that
        // locks down a lane — WF Sub Strike's effect, paid in charge.
        name: 'EMP Torpedo',
        isBuiltIn: true,
        cardText: 'Discharge 2 from a friendly LH vehicle: remove target enemy submarine in that zone from play.',
        materialCost: 100000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'empTorpedo.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.LH,
        blueprintId: null,
        meta: { [TRIGGERS.PLAY_ON_VEHICLE]: 'empTorpedoEffect', dischargeFrom: 2 },
    },
```

In `supabase/seed/balance/lh.balance.test.ts`, add this entry to `CARDS` directly after the `'LH:Feedback Loop'` entry:

```ts
  // The 2026-09-23 EMP Torpedo amendment (docs/superpowers/specs/2026-09-23-lh-emp-torpedo-design.md).
  'LH:EMP Torpedo': {
    materialCost: 100_000, blueprintCost: 0, cpCost: 0, keywords: [], vehicleType: null,
    cardText: 'Discharge 2 from a friendly LH vehicle: remove target enemy submarine in that zone from play.',
    meta: { playOnVehicleEffect: 'empTorpedoEffect', dischargeFrom: 2 },
  },
```

In the same file, replace the roster-shape test's comment, name and counts:

```ts
  // 28 + Faraday and Data Burst (2026-09-22 draw amendment) + Feedback Loop (2026-09-23);
  // − Byte − Hydrovolt + Anode (2026-09-22 hovercraft amendment); + EMP Torpedo
  // (2026-09-23 EMP Torpedo amendment). Byte and Hydrovolt join the 8 retired
  // rows, so 31 draftable + 10 retired = 41 rows.
  it('seeds 31 draftable LH cards and keeps the 10 retired rows', async () => {
    const { cards } = await loadSeedData()
    const lh = cards.filter((c) => c.faction === 'LH')
    const live = lh.filter((c) => (c.meta as Record<string, unknown>)?.retired !== true)
    expect(live).toHaveLength(31)
    expect(lh).toHaveLength(41)
    expect(live.map((c) => c.name).sort()).toEqual(Object.keys(CARDS).map((k) => k.slice(3)).sort())
  })
```

Leave the `24` in the next test alone: that test counts vehicles, and EMP Torpedo is an ability.

- [ ] **Step 7: Regenerate the seed SQL and the function copies**

```powershell
npm run seed:build
npm run functions:sync
```

Expected: `seed:build` prints `Wrote 195 cards + … hero powers to …seed_data.sql`, and `git status` then shows `supabase/seed/seed_data.sql` modified. `functions:sync` rewrites `supabase/functions/game-action/shared/effects/lhEffects.ts` and `supabase/functions/lobby-action/shared/effects/lhEffects.ts`.

- [ ] **Step 8: Run the guards, then the full suite**

```powershell
npx vitest run supabase/seed/balance/lh.balance.test.ts supabase/seed/effectCoverage.test.ts supabase/seed/seedDataSync.test.ts supabase/seed/functionSharedSync.test.ts
npx vitest run
```

Expected: all pass. The coverage guard's G1–G4 pass with `KNOWN_GAPS` still empty and `DELIBERATE_ORPHANS` unchanged. The full-suite count is at least the Step 0 baseline + 10: eight engine tests, one evaluator test, and the balance test's new `it.each` row. Any test that iterates over every seeded card may add more. Nothing may fail. If anything else fails, stop and diagnose; do not edit unrelated tests.

- [ ] **Step 9: Commit**

```powershell
git add shared/effects/lhEmpTorpedo.test.ts shared/effects/lhEffects.ts shared/ai/evaluator.test.ts supabase/seed/source/builtInCards/LH-Built-in.js supabase/seed/balance/lh.balance.test.ts supabase/seed/seed_data.sql supabase/functions/game-action/shared/effects/lhEffects.ts supabase/functions/lobby-action/shared/effects/lhEffects.ts
git status --short
git commit -m "feat(lh): EMP Torpedo removes an enemy sub for two pips - empTorpedoEffect" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git status --short` must show nothing else staged, and no `.env.local`.

---

### Task 2: PracticeAI — the bot deck and the strategy notes

**Files:**
- Modify: `shared/ai/llm/factionNotes.ts` (the last line of the LH `text` and the `mentions` array)
- Modify: `shared/ai/botDecks.ts` (the LH deck and its comment)
- Regenerate: `supabase/functions/{game-action,lobby-action}/shared/ai/llm/factionNotes.ts` and `…/shared/ai/botDecks.ts`

**Interfaces:**
- Consumes: the seed card `LH:EMP Torpedo` from Task 1. `factionNotes.test.ts` requires every mention to be a seeded, draftable LH card that is in `BOT_DECKS.LH`.
- Produces: nothing later tasks call.

- [ ] **Step 1: Point the notes at the card (this makes the notes test fail)**

In `shared/ai/llm/factionNotes.ts`, in the `LH` entry, replace the last line of `text`:

```ts
- Lasers stop at the water: play Anode's Sub Screen where enemy submarines would hurt.`,
```

with:

```ts
- Lasers stop at the water, so a fleet battle cannot sink a submarine. EMP Torpedo removes one for two pips from a hull in its lane — Ampere lands fully charged, so it can pay the turn it arrives — and Anode's Sub Screen keeps new ones out.`,
```

Then add `'EMP Torpedo'` to the end of the LH `mentions` array, which becomes:

```ts
    mentions: [
      'Kilowatt', 'Anode', 'Angstrom', 'Chrysoprase', 'Volta', 'Dipole', 'Conduit',
      'Overcharge', 'Ampere', 'Penumbra', 'EMP Salvo', 'Umbra', 'Eclipse', 'Watt', 'Faraday', 'Data Burst', 'Megawatt',
      'EMP Torpedo',
    ],
```

- [ ] **Step 2: Run the notes test and confirm it fails**

```powershell
npx vitest run shared/ai/llm/factionNotes.test.ts
```

Expected: **FAIL** in the `LH` block, with the message `"EMP Torpedo" is not in the bot's LH deck — the advice is inert`.

- [ ] **Step 3: Put the card in the LH bot deck**

In `shared/ai/botDecks.ts`, in `BOT_DECKS.LH`, change `'Chrysoprase': 2,` to `'Chrysoprase': 1,` and add `'EMP Torpedo': 1,` as the last entry (after `'Data Burst': 1,`). Then append this line to the comment block directly above `LH: {`:

```ts
  // 2026-09-23 EMP Torpedo amendment: EMP Torpedo in for the second Chrysoprase
  // — LH's answer to a sub that locks down a lane. Still 20 cards; fliers 3 of 6.
```

- [ ] **Step 4: Run the bot tests and confirm they pass**

```powershell
npx vitest run shared/ai/llm/factionNotes.test.ts shared/ai/botDecks.test.ts
```

Expected: **PASS**. The deck is still 20 cards, passes `validateDeck`, and holds 16 vehicles (≥ 12) with at least one turn-one and three turn-two plays.

- [ ] **Step 5: Sync the function copies and run the full suite**

```powershell
npm run functions:sync
npx vitest run
```

Expected: all pass, with the same count as Task 1 Step 8. No tests were added; the existing ones now cover the new names.

- [ ] **Step 6: Commit**

```powershell
git add shared/ai/llm/factionNotes.ts shared/ai/botDecks.ts supabase/functions/game-action/shared/ai/llm/factionNotes.ts supabase/functions/lobby-action/shared/ai/llm/factionNotes.ts supabase/functions/game-action/shared/ai/botDecks.ts supabase/functions/lobby-action/shared/ai/botDecks.ts
git status --short
git commit -m "feat(ai): LH bot deck carries EMP Torpedo; the notes name it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Gates and the PR

No code changes unless a gate fails. If one does, fix the cause in a new commit and re-run every gate.

**Files:** none (a PR body file in `$env:TEMP`, never committed).

- [ ] **Step 1: Make sure the branch is up to date with `main`**

```powershell
git fetch origin
git log --oneline HEAD..origin/main
```

Expected: no output. If there is output, run `git merge origin/main` (resolve any conflicts; seed data and `functions:sync` output are regenerated, never hand-merged), then `npm run seed:build`, `npm run functions:sync`, and commit the result.

- [ ] **Step 2: Run every gate**

```powershell
npx vitest run
npx tsc -p tsconfig.json --noEmit
npm --prefix frontend run build
npm --prefix frontend run lint
npm run functions:check
```

Expected: every command passes. Report the suite count as **before → after** (the Step 0 baseline → now).

- [ ] **Step 3: Secrets audit** (docs/claude/workflow.md, before every push)

```powershell
git diff origin/main...HEAD | Select-String -Pattern 'service_role|sb_secret|SUPABASE_SERVICE|BEGIN [A-Z ]*PRIVATE KEY|eyJhbGciOi'
git diff origin/main...HEAD --name-only
```

Expected: the first command prints nothing. The file list holds only the files from Tasks 1–2, plus the spec, the plan and the 2026-09-21 spec pointers, and no `.env.local`.

- [ ] **Step 4: Push and open the PR (the owner merges, never the implementer)**

Write the PR body to `$env:TEMP\emp-torpedo-pr-body.md`, replacing `BEFORE → AFTER` with the real suite counts:

```markdown
## EMP Torpedo — LH's answer to submarines

Spec: `docs/superpowers/specs/2026-09-23-lh-emp-torpedo-design.md` (plan: `docs/superpowers/plans/2026-09-23-lh-emp-torpedo.md`)

- New LH ability **EMP Torpedo** (100k, 0 CP): "Discharge 2 from a friendly LH vehicle: remove target enemy submarine in that zone from play." It is WF Sub Strike's effect, paid in pips.
  - It removes the sub without destroying it, so no death trigger fires.
  - Stealthy subs can be targeted.
  - With no sub in the paying vehicle's lane, the play is refused and nothing is spent.
- New effect `empTorpedoEffect` in `lhEffects.ts`. No engine or frontend change.
- PracticeAI: EMP Torpedo replaces the second Chrysoprase, and the strategy notes' submarine line names it.
- Seed: 195 cards (one new row, applied after merge by `seed-apply.yml`).

### Tests
- `lhEmpTorpedo.test.ts` (8 tests), one evaluator test (the scored flow ranks the torpedo above END TURN), and a balance pin. Suite BEFORE → AFTER.
- Gates: root tsc, frontend build and lint, `functions:check`; `functions:sync` and `seed:build` committed; secrets audit clean.

### After merge
- [ ] The `seed-apply.yml` run is green, and `npm run seed:verify` reports 195 cards, drift 0
- [ ] game-action and lobby-action are redeployed, and their bodies carry `empTorpedoEffect`
- [ ] The Netlify `GameBoardPage` chunk carries `empTorpedoEffect`
- [ ] Owner, live: Ampere + EMP Torpedo on a lane with a sub; the red banner appears with no 2-pip LH vehicle

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then:

```powershell
git push -u origin claude/lh-submarine-solution-ee8476
gh pr create --base main --head claude/lh-submarine-solution-ee8476 --title "LH: EMP Torpedo, an answer to submarines" --body-file "$env:TEMP\emp-torpedo-pr-body.md"
```

Report the PR URL. **Do not merge**: merging is the owner's call (docs/claude/workflow.md), and it is what deploys the functions and triggers the seed job.

---

### Task 4: After the owner merges — post-merge checks

Run only once the owner has merged the PR. Merging deploys code (the Supabase GitHub integration) and applies the seed (`seed-apply.yml`) separately, so check both, plus Netlify.

**Files:** a throwaway `$env:TEMP\emp-torpedo-post-merge.mjs` (never committed).

- [ ] **Step 1: The seed job and seed drift**

```powershell
gh run list --workflow seed-apply.yml --limit 1
npm run seed:verify
```

Expected: the latest run is `completed success` for the merge commit. `seed:verify` reports 195 cards and drift 0; it reads `SUPABASE_ACCESS_TOKEN` from the worktree's `.env.local`, copied in Task 1 Step 0. If the run failed or the drift is not 0, read the run log. **Never hand-apply the SQL** (CLAUDE.md): `npm run seed:apply` then `npm run seed:verify` closes a gap.

- [ ] **Step 2: Functions and Netlify, by content**

Create `$env:TEMP\emp-torpedo-post-merge.mjs`:

```js
// Throwaway post-merge check (never committed): deployed function bodies and
// the live Netlify bundle must carry the new effect id.
import { existsSync, readFileSync } from 'node:fs'

const REF = 'wpgsjnjnvykxavaxibld'
const fromFile = existsSync('.env.local')
  ? readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  : undefined
const token = process.env.SUPABASE_ACCESS_TOKEN ?? fromFile
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN missing (environment or ./.env.local)')
const api = (path) => fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, { headers: { Authorization: `Bearer ${token}` } })

const fns = await (await api('/functions')).json()
for (const slug of ['game-action', 'lobby-action']) {
  const version = fns.find((f) => f.slug === slug)?.version
  const body = await (await api(`/functions/${slug}/body`)).text()
  console.log(`${slug} v${version}: empTorpedoEffect=${body.includes('empTorpedoEffect')} notes=${body.includes('EMP Torpedo removes one')}`)
}

const site = 'https://ftd-card-game.netlify.app'
const html = await (await fetch(site)).text()
const entry = html.match(/\/assets\/index-[\w-]+\.js/)?.[0]
if (!entry) throw new Error('entry chunk not found in index.html')
const entryJs = await (await fetch(site + entry)).text()
const board = entryJs.match(/GameBoardPage-[\w-]+\.js/)?.[0]
if (!board) throw new Error('GameBoardPage chunk not referenced by the entry chunk; find it in the network panel')
const boardJs = await (await fetch(`${site}/assets/${board}`)).text()
console.log(`netlify ${board}: empTorpedoEffect=${boardJs.includes('empTorpedoEffect')}`)
```

Run it from the worktree root, so that `.env.local` resolves:

```powershell
node "$env:TEMP\emp-torpedo-post-merge.mjs"
```

Expected: both functions print `empTorpedoEffect=true notes=true`, and Netlify prints `empTorpedoEffect=true`. The content check is the proof; a version bump alone proves nothing. Report the versions anyway.
- **A function reads `false`:** the integration may have skipped the deploy (a failed migrate step silently skips it; docs/claude/supabase.md). Check the merge's CI, then redeploy with `npm run functions:deploy -- game-action` (and `lobby-action`) from a branch up to date with `main`. Never use the MCP deploy tool or a subagent for this.
- **Netlify reads `false`:** check whether the build ran (memory: Netlify can cancel a build silently).

- [ ] **Step 3: Report**

Report to the owner:
- the seed run and the drift;
- both function versions, and the fact that they were verified by content;
- the Netlify chunk;
- what is still theirs: the live play-through (Ampere + EMP Torpedo on a lane with a sub, and the red banner with no 2-pip LH vehicle).

Per card-effects.md rule 3, also state that no spec effect is left unimplemented. This amendment has exactly one effect, and it shipped.
