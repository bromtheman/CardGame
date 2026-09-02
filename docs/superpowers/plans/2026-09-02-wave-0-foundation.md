# Balance Pass Wave 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire five cards safely, and give the five faction waves a foundation they cannot collide on.

**Architecture:** A new `retired: true` card meta key excludes a card from deck
validation, the deck builder, and every effect draw pool — while leaving the row
seeded, so in-flight games and unedited decks still resolve it. Alongside it,
the shared guard file is split per faction so five branches never edit one file,
and a factually wrong rule in the agent docs is corrected.

**Tech Stack:** TypeScript (strict), Vitest, React 19 + Tailwind v4, TanStack
Query v5. Pure game rules live in `shared/` and are imported by both the
frontend and the Deno edge functions.

**Spec:** [docs/superpowers/specs/2026-09-02-balance-pass-design.md](../specs/2026-09-02-balance-pass-design.md)
— read §2 and §5 before starting. This plan implements §2 in full.

## Global Constraints

- **Shell is PowerShell.** No `&&` chaining — use `;` or separate calls.
- **Every commit touching `shared/` must include `npm run functions:sync` output.**
  `supabase/seed/functionSharedSync.test.ts` fails otherwise.
- **Relative imports inside `shared/` require the `.ts` extension** — Deno runs
  these files verbatim inside edge functions.
- **Run the full suite with `npx vitest run`. NEVER pass `--root`** — it
  silently runs 0 tests.
- **A card's `name` is immutable.** `transform.ts` derives each row's uuid from
  `card:<faction>:<name>`; renaming mints a new id and orphans every deck
  holding the old one. This wave renames nothing.
- **Any edit to `supabase/seed/source/**` requires `npm run seed:build` in the
  same commit**, or `supabase/seed/seedDataSync.test.ts` fails.
- **Public `state.log` must never name a card in a hidden hand.**
- Report the suite's **before→after passing count** at the end of the wave, not
  "tests pass".

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `shared/engine/deckValidation.ts` | `DeckCardInfo.retired`, and the rejection rule | Modify |
| `shared/engine/deckValidation.test.ts` | Rejection is by retirement, distinctly from summon-only | Modify |
| `shared/effects/primitives.ts` | New `poolEligible()` — the single pool-exclusion predicate | Modify |
| `shared/effects/primitives.test.ts` | A retired catalog card is never minted | Modify |
| `shared/effects/dwgEffects.ts` | 2 hand-rolled pool filters → `poolEligible` | Modify |
| `shared/effects/lhEffects.ts` | 1 hand-rolled pool filter → `poolEligible` | Modify |
| `shared/effects/ssEffects.ts` | 2 hand-rolled catalog lookups → `poolEligible` | Modify |
| `shared/effects/wfEffects.ts` | 1 hand-rolled pool filter → `poolEligible` | Modify |
| `supabase/seed/source/builtInCards/{OW,SS,TG,WF}-*.js` | `retired: true` on the five cards | Modify |
| `supabase/seed/seed_data.sql` | Generated — never hand-edited | Regenerate |
| `supabase/seed/retirement.test.ts` | Seed-backed: exactly these five rows are retired | Create |
| `supabase/seed/balance/{dwg,ow,ss,tg,wf}.balance.test.ts` | Per-faction pinned numbers, one file per wave | Create |
| `frontend/src/pages/DeckBuilderPage.tsx` | Hide retired from the pool; surface any the deck still holds | Modify |
| `frontend/src/pages/DecksPage.tsx` | "Contains a retired card" badge | Modify |
| `docs/claude/card-effects.md` | Correct rule 10 | Modify |

**Why `poolEligible` is extracted rather than the exclusion repeated.** The
`summonOnly` guard is currently copy-pasted at **six** call sites that filter
`ctx.catalog` directly (the spec §2.1 says five — it undercounts; the sites are
`dwgEffects.ts` ×2, `lhEffects.ts` ×1, `ssEffects.ts` ×2, `wfEffects.ts` ×1).
Every one of them is a place the next exclusion gets forgotten, and `retired` is
that next exclusion. One predicate, six call sites, and the seventh site added
later inherits both rules.

---

### Task 1: `retired` rejects a card from deck validation

**Files:**
- Modify: `shared/engine/deckValidation.ts:29` (interface), `:64-67` (rule)
- Test: `shared/engine/deckValidation.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DeckCardInfo.retired?: boolean`. Task 4 populates it from
  `card.meta.retired` in `DeckBuilderPage`; `lobby-action` picks it up through
  the synced copy of this module with no edit of its own.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('validateDeck', …)` block in
`shared/engine/deckValidation.test.ts`:

```ts
  it('rejects a retired card and says it is retired', () => {
    const infoMap = legalInfo()
    infoMap.set(...info('dwg-0', { retired: true }))
    const r = validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('dwg-0') && /retired/i.test(e))).toBe(true)
  })

  // The two rules are distinct on purpose: a summon-only card was NEVER
  // draftable, a retired one was legal until a balance pass moved. 25 live
  // decks hit this message, and it is the only thing that tells their owners
  // what changed.
  it('does not report a retired card as summon-only', () => {
    const infoMap = legalInfo()
    infoMap.set(...info('dwg-0', { retired: true }))
    const r = validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME)
    expect(r.errors.join(' ')).not.toMatch(/cannot be added to a deck/)
  })

  // Retirement is checked before faction, so an off-faction retired card
  // reports the actionable reason rather than a second, confusing one.
  it('reports retirement once, not alongside a faction error', () => {
    const infoMap = legalInfo()
    infoMap.set(...info('dwg-0', { retired: true, faction: 'SS' }))
    const r = validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME)
    expect(r.errors.filter((e) => e.includes('dwg-0'))).toHaveLength(1)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run shared/engine/deckValidation.test.ts
```

Expected: 3 failures. The first two fail on `valid` being `true` (no rule
exists yet); the third fails with 1 faction error where it wanted a retirement
one.

- [ ] **Step 3: Add the field to the interface**

In `shared/engine/deckValidation.ts`, extend `DeckCardInfo` (currently ending at
line 29 with `summonOnly?: boolean`):

```ts
  // Spawned, never drafted (spec §7.1).
  summonOnly?: boolean
  // Retired by a balance pass (2026-09-02 spec §2.1). The row stays seeded so
  // in-flight games and unedited decks still resolve the snapshot — this flag
  // is what stops it being a legal deck card from here on.
  retired?: boolean
```

- [ ] **Step 4: Add the rule**

In `validateDeck`, immediately after the `summonOnly` block (line 64-67) and
**before** the `isBuiltIn` faction check:

```ts
    if (card.retired) {
      errors.push(`Card ${cardId} has been retired and can no longer be used in a deck`)
      continue
    }
```

The `continue` is what makes the third test pass: it stops the faction check
adding a second error for the same card.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run shared/engine/deckValidation.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 6: Sync and commit**

```bash
npm run functions:sync
git add shared/engine/deckValidation.ts shared/engine/deckValidation.test.ts supabase/functions
git commit -m "feat(decks): a retired card is not a legal deck card"
```

---

### Task 2: One pool-exclusion predicate, six call sites

**Files:**
- Modify: `shared/effects/primitives.ts` (add `poolEligible`, use it in `drawFromPool`)
- Modify: `shared/effects/dwgEffects.ts:92-93`, `:352-358`
- Modify: `shared/effects/lhEffects.ts:82-83`
- Modify: `shared/effects/ssEffects.ts:52`, `:232`
- Modify: `shared/effects/wfEffects.ts:215-221`
- Test: `shared/effects/primitives.test.ts`

**Interfaces:**
- Consumes: `DeckCardInfo.retired` from Task 1 only conceptually — this task
  reads `meta.retired` off catalog snapshots, not off `DeckCardInfo`.
- Produces: `export function poolEligible(c: { meta: Record<string, unknown> }): boolean`
  from `shared/effects/primitives.ts`. No later task in this wave consumes it;
  the faction waves do, whenever they add a pool.

- [ ] **Step 1: Write the failing test**

Append to `shared/effects/primitives.test.ts`:

```ts
describe('poolEligible', () => {
  it('excludes summon-only and retired cards, and admits everything else', () => {
    expect(poolEligible({ meta: {} })).toBe(true)
    expect(poolEligible({ meta: { summonOnly: true } })).toBe(false)
    expect(poolEligible({ meta: { retired: true } })).toBe(false)
  })

  // Guards against a truthiness bug: only the boolean `true` excludes, the
  // same comparison every existing summonOnly site makes.
  it('treats any non-true value as eligible', () => {
    expect(poolEligible({ meta: { retired: false } })).toBe(true)
    expect(poolEligible({ meta: { retired: 'yes' } })).toBe(true)
  })
})

describe('drawFromPool excludes retired cards', () => {
  it('never mints a retired card from the catalog', () => {
    const live = snap({ name: 'Live', faction: 'DWG', type: 'vehicle', vehicleType: 'ship' })
    const dead = snap({
      name: 'Dead', faction: 'DWG', type: 'vehicle', vehicleType: 'ship',
      meta: { retired: true },
    })
    const game = makeGame()
    const ok = drawFromPool({ source: 'catalog', filter: { faction: 'DWG' }, count: 5 })(
      { game, actor: 'a', card: inst(), ctx: makeCtx({ catalog: [live, dead] }) },
    )
    expect(ok).toBe(true)
    expect(game.privates.a.hand.map((c) => c.name)).toEqual(['Live'])
  })
})
```

Add `poolEligible` to the existing `./primitives.ts` import at the top of the
file. `inst`, `makeCtx`, `makeGame` and `snap` are already imported there from
`'../engine/testFixtures.ts'` — do not add new fixtures.

Asserting `toEqual(['Live'])` rather than `not.toContain('Dead')` is deliberate:
a filter bug that excluded *everything* would satisfy the negative form.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run shared/effects/primitives.test.ts
```

Expected: FAIL with `poolEligible is not defined` (or an import error).

- [ ] **Step 3: Add the predicate**

In `shared/effects/primitives.ts`, above `drawFromPool`:

```ts
/**
 * Cards no pool may mint or draw: never-drafted summons (spec §7.4) and cards
 * retired by a balance pass (2026-09-02 spec §2.1).
 *
 * Extracted because this exclusion was repeated by hand at six sites that
 * filter `ctx.catalog` directly — and every one of them was a place the NEXT
 * exclusion would be forgotten. `retired` was that next exclusion.
 */
export function poolEligible(c: { meta: Record<string, unknown> }): boolean {
  return c.meta.summonOnly !== true && c.meta.retired !== true
}
```

- [ ] **Step 4: Use it in `drawFromPool`**

Replace the catalog filter (currently
`ctx.catalog.filter((c) => c.isBuiltIn && c.meta.summonOnly !== true && matches(c, spec.filter))`):

```ts
      const pool = ctx.catalog.filter((c) => c.isBuiltIn && poolEligible(c) && matches(c, spec.filter))
```

The `source: 'deck'` branch is deliberately **not** changed: a card already in
the owner's deck was dealt before retirement and stays playable, exactly as it
does in an in-flight game.

- [ ] **Step 5: Convert the six hand-rolled sites**

Add `poolEligible` to each file's existing `./primitives.ts` import, then:

`shared/effects/dwgEffects.ts` — `reservesEffect` (line 92-93):

```ts
  const pool = ctx.catalog.filter((c) =>
    c.isBuiltIn && c.faction === 'DWG' && c.type === 'vehicle' && poolEligible(c))
```

`shared/effects/dwgEffects.ts` — `dwgGuestPool` (line 352-358):

```ts
function dwgGuestPool(ctx: EngineContext): SnapshotCard[] {
  return ctx.catalog.filter((c) =>
    c.isBuiltIn &&
    c.faction === 'DWG' &&
    c.type === 'vehicle' &&
    c.materialCost < DWG_WATERS_GUEST_MAX_COST &&
    poolEligible(c))
}
```

`shared/effects/lhEffects.ts` — `roboticAssemblersEffect` (line 82-83):

```ts
  options: ({ ctx }) => ctx.catalog
    .filter((c) => c.isBuiltIn && c.meta[LH_ROBOTICS_POOL] === true && poolEligible(c))
```

`shared/effects/ssEffects.ts` — `balmungOnPlay` (line 52):

```ts
  if (!hydra || !poolEligible(hydra)) return false
```

`shared/effects/ssEffects.ts` — `victoriaActivate` (line 232):

```ts
  if (!snapshot || !poolEligible(snapshot)) return false
```

`shared/effects/wfEffects.ts` — the Harbringer guest pool (line 215-221):

```ts
  return ctx.catalog.filter((c) =>
    c.isBuiltIn &&
    c.faction === 'WF' &&
    c.type === 'vehicle' &&
    c.vehicleType === VEHICLE_TYPES.SHIP &&
    c.materialCost <= HARBRINGER_GUEST_MAX_COST &&
    poolEligible(c))
```

Update each site's surrounding comment: the ones that say the exclusion "is
repeated by hand because this filters `ctx.catalog` directly" are now false.
Say instead that the site uses the shared predicate.

- [ ] **Step 6: Run the full suite**

```bash
npx vitest run
```

Expected: PASS. Nothing is retired yet, so `poolEligible` is behaviourally
identical to the six `summonOnly` checks it replaces — a failure here means a
call site was converted wrongly, not that a card changed.

- [ ] **Step 7: Sync and commit**

```bash
npm run functions:sync
git add shared/effects supabase/functions
git commit -m "refactor(effects): one pool-exclusion predicate, and it knows about retirement"
```

---

### Task 3: Retire the five cards in the seed

**Files:**
- Modify: `supabase/seed/source/builtInCards/OW-Built-in.js` (Halberd)
- Modify: `supabase/seed/source/builtInCards/SS-built-in.js` (Dryad)
- Modify: `supabase/seed/source/builtInCards/TG-built-in.js` (Amusement, Acceptance)
- Modify: `supabase/seed/source/builtInCards/WF-built-in.js` (Harbringer)
- Regenerate: `supabase/seed/seed_data.sql`
- Test: `supabase/seed/retirement.test.ts` (create)

**Interfaces:**
- Consumes: `poolEligible` (Task 2) and the validation rule (Task 1) — both
  must be merged first, or this task retires cards that nothing excludes.
- Produces: exactly five seeded rows carrying `meta.retired === true`.

- [ ] **Step 1: Write the failing test**

Create `supabase/seed/retirement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadSeedData } from './transform'

// A data key's VALUE is never checked by G1/G2/G3 — only its presence
// (docs/claude/card-effects.md, blind spot 4). `retired` gates deck legality
// for 25 live decks, so it gets its own seed-backed assertion.
//
// Asserted in BOTH directions: a card missing from this list is not retired,
// and a card in it is. A one-directional check would stay green if a later
// pass retired a card by accident.
const RETIRED = ['OW:Halberd', 'SS:Dryad', 'TG:Acceptance', 'TG:Amusement', 'WF:Harbringer']

describe('2026-09-02 retirements', () => {
  it('retires exactly the five cards the pass names', async () => {
    const { cards } = await loadSeedData()
    const actual = cards
      .filter((c) => (c.meta as { retired?: unknown } | undefined)?.retired === true)
      .map((c) => `${c.faction}:${c.name}`)
      .sort()
    expect(actual).toEqual([...RETIRED].sort())
  })

  // Retirement keeps the ROW. Deleting it would break 25 saved decks at game
  // start rather than at deck edit — gameInit's expandDeck throws on a
  // dangling card id (spec §2.1).
  it('keeps every retired card seeded, so snapshots still resolve', async () => {
    const { cards } = await loadSeedData()
    const byKey = new Set(cards.map((c) => `${c.faction}:${c.name}`))
    for (const key of RETIRED) expect(byKey.has(key)).toBe(true)
  })

  // The effects these cards name keep a naming card, so G4 stays green and
  // none of them belongs in DELIBERATE_ORPHANS (spec §5).
  it('leaves the retired cards still naming their effects', async () => {
    const { cards } = await loadSeedData()
    const meta = (key: string) =>
      (cards.find((c) => `${c.faction}:${c.name}` === key)!.meta ?? {}) as Record<string, unknown>
    expect(meta('OW:Halberd').onDeathEffect).toBe('halberdOnDeath')
    expect(meta('SS:Dryad').onBattleEffect).toBe('dryadBattle')
    expect(meta('WF:Harbringer').onBattleEffect).toBe('harbringerBattle')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run supabase/seed/retirement.test.ts
```

Expected: FAIL — the first test finds `[]` where it wanted five keys.

- [ ] **Step 3: Add the flag to the five cards**

In each source file, add `retired: true` to the card's existing `meta` object.
Do not touch its `name`, its costs, its keywords, or the effect names already
in `meta`. For a card whose `meta` is `{}` (Amusement), the result is
`meta: { retired: true }`.

Add this comment above the first one you edit, and reference it from the others:

```js
// Retired by the 2026-09-02 balance pass. The row stays here on purpose: it
// keeps being upserted, so in-flight games and unedited decks still resolve
// the snapshot. `retired: true` is what makes it undraftable from here on.
// See docs/superpowers/specs/2026-09-02-balance-pass-design.md §2.1.
```

- [ ] **Step 4: Regenerate the seed SQL**

```bash
npm run seed:build
```

Expected: `Wrote 159 cards + 7 hero powers`. The count does **not** change —
retirement adds a key, it does not remove a row.

- [ ] **Step 5: Run the full suite**

```bash
npx vitest run
```

Expected: PASS, including `seedDataSync.test.ts` (which would fail if step 4
were skipped) and `effectCoverage.test.ts` G4 (which stays green because the
retired cards still name their effects).

- [ ] **Step 6: Commit**

```bash
git add supabase/seed
git commit -m "balance(cards): retire Halberd, Dryad, Amusement, Acceptance and Harbringer"
```

---

### Task 4: The deck builder hides retired cards and surfaces held ones

**Files:**
- Modify: `frontend/src/pages/DeckBuilderPage.tsx:52-74`

**Interfaces:**
- Consumes: `DeckCardInfo.retired` (Task 1); `meta.retired` on card rows (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Widen the meta cast and exclude retired cards from the pool**

Replace the `pool` memo (lines 52-62). The existing cast reads only
`summonOnly`, so it must widen or `retired` is invisible to TypeScript:

```tsx
  const pool = useMemo(
    () =>
      (allCards ?? []).filter((c) => {
        const meta = c.meta as { summonOnly?: boolean; retired?: boolean } | null
        // A retired card is hidden from the pool but NOT from the deck below —
        // an owner has to be able to see the card they must remove.
        if (meta?.summonOnly === true || meta?.retired === true) return false
        return c.is_built_in
          ? c.faction === deck?.faction || c.faction === FACTIONS.NEUTRAL
          : c.owner_id === session?.user.id
      }),
    [allCards, deck, session],
  )
```

- [ ] **Step 2: Feed `retired` into validation**

In the `validation` memo (lines 64-74), extend the `infoMap` entry:

```tsx
      allCards.map((c) => [c.id, {
        id: c.id, isBuiltIn: c.is_built_in, faction: c.faction,
        vehicleType: c.vehicle_type, ownerId: c.owner_id,
        summonOnly: (c.meta as { summonOnly?: boolean } | null)?.summonOnly === true,
        retired: (c.meta as { retired?: boolean } | null)?.retired === true,
      }]),
```

- [ ] **Step 3: Name the retired cards the deck still holds**

Add below the `validation` memo:

```tsx
  // The 25 decks affected by the 2026-09-02 retirements land here. validateDeck
  // already reports the error; this is what turns it into an instruction by
  // naming the card, which the error (keyed by id) cannot.
  const retiredHeld = useMemo(
    () => Object.keys(cards)
      .map((id) => (allCards ?? []).find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> =>
        !!c && (c.meta as { retired?: boolean } | null)?.retired === true)
      .map((c) => c.name),
    [cards, allCards],
  )
```

Render it above the existing validation output:

```tsx
      {retiredHeld.length > 0 && (
        <p className="mt-4 rounded border border-amber-500 bg-amber-950/40 p-3 text-amber-200">
          {retiredHeld.join(', ')} {retiredHeld.length === 1 ? 'has' : 'have'} been
          retired and can no longer be used. Remove {retiredHeld.length === 1 ? 'it' : 'them'} and
          add {retiredHeld.length === 1 ? 'another card' : 'other cards'} to make this fleet legal again.
        </p>
      )}
```

- [ ] **Step 4: Verify the build and lint**

```bash
npm --prefix frontend run build
```

Expected: clean. Then:

```bash
npm --prefix frontend run lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DeckBuilderPage.tsx
git commit -m "feat(decks): the builder hides retired cards and names the ones a deck still holds"
```

---

### Task 5: DecksPage badges an affected deck

**Files:**
- Modify: `frontend/src/pages/DecksPage.tsx`

**Interfaces:**
- Consumes: `useCardsQuery` from `../lib/cards` (already exists, already used by
  DeckBuilderPage); `meta.retired` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Load the cards and derive the retired id set**

Add the import and, beside the existing `useDecksQuery()` call:

```tsx
import { useCardsQuery } from '../lib/cards'
```

```tsx
  const { data: allCards } = useCardsQuery()
  // A Set of ids rather than a per-deck lookup: this renders once per deck and
  // the card list is ~160 rows.
  const retiredIds = useMemo(
    () => new Set((allCards ?? [])
      .filter((c) => (c.meta as { retired?: boolean } | null)?.retired === true)
      .map((c) => c.id)),
    [allCards],
  )
```

Add `useMemo` to the existing `react` import.

- [ ] **Step 2: Badge the affected decks**

Inside the `{(decks ?? []).map((d) => (…))}` list item, after the card-count
span:

```tsx
              {Object.keys((d.cards ?? {}) as Record<string, number>)
                .some((id) => retiredIds.has(id)) && (
                <span className="ml-3 rounded bg-amber-600 px-2 py-0.5 text-sm text-ocean-950">
                  contains a retired card
                </span>
              )}
```

- [ ] **Step 3: Verify the build and lint**

```bash
npm --prefix frontend run build
```

Expected: clean. Then:

```bash
npm --prefix frontend run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DecksPage.tsx
git commit -m "feat(decks): badge a fleet that holds a retired card"
```

---

### Task 6: Split the balance guard per faction

**Files:**
- Create: `supabase/seed/balance/dwg.balance.test.ts`
- Create: `supabase/seed/balance/ow.balance.test.ts`
- Create: `supabase/seed/balance/ss.balance.test.ts`
- Create: `supabase/seed/balance/tg.balance.test.ts`
- Create: `supabase/seed/balance/wf.balance.test.ts`

**Interfaces:**
- Consumes: `loadSeedData` from `../transform` (note the `../` — these files sit
  one directory deeper than `balancePass.test.ts`).
- Produces: one file per faction wave to add its pinned numbers to. **No wave
  edits another wave's file.**

`supabase/seed/balancePass.test.ts` is **not** moved or rewritten here. It pins
the 2026-08-30 numbers, which are still true today; the faction waves update
the four assertions this pass invalidates (spec §7.2) in place.

- [ ] **Step 1: Create the five files**

Each is the same shape. `dwg.balance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'

// The 2026-09-02 balance pass — DWG's share, pinned against the seed source.
//
// One file per faction so the five faction branches never edit the same test
// file (spec §2.3). Costs, keywords and card text are plain data that nothing
// else in the suite reads: effectCoverage asks only whether a card's EFFECTS
// are wired, and seedDataSync only whether the generated SQL matches its
// source. Both stay green if a number is fat-fingered. This file would not.
//
// Numbers are spelled out, never derived — a test that recomputes its
// expectation from the source it is checking proves nothing.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

describe('2026-09-02 balance pass — DWG', () => {
  // Populated by the DWG wave. Vitest fails a file with no tests at all, so
  // this placeholder keeps the suite green until then. The wave that fills the
  // file deletes it.
  it('has a seed to read', async () => {
    expect((await bySeedKey()).size).toBeGreaterThan(0)
  })
})
```

Create the other four by copying that file verbatim and changing exactly three
things: `DWG` → `OW` / `SS` / `TG` / `WF` in the header comment, in the
`describe` title, and nowhere else.

`bySeedKey` is **deliberately duplicated into each file rather than shared**.
Extracting it to a helper module would put five branches back into one file on
every edit — which is the single thing this task exists to prevent. Five copies
of four lines is the cheaper trade.

- [ ] **Step 2: Confirm vitest collects them**

```bash
npx vitest run supabase/seed/balance
```

Expected: 5 passed files, 5 passed tests. The `include` glob in
`vitest.config.ts` is `supabase/seed/**/*.test.ts`, so the new subdirectory is
picked up with no config change — **verify that in the output rather than
assuming it**, because a plan that silently collects 0 files is the failure
mode `--root` is warned about.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed/balance
git commit -m "test(guard): one balance file per faction, so five branches never collide"
```

---

### Task 7: Correct card-effects rule 10, and close the wave

**Files:**
- Modify: `docs/claude/card-effects.md` (rule 10 in "Adding a new effect — checklist")

**Interfaces:**
- Consumes: nothing.
- Produces: the corrected rule the SS wave relies on to keep Argonaut's
  `SCRAPPY` (spec R-4).

- [ ] **Step 1: Replace rule 10**

The current text is:

> 10. **A built-in card must not carry both `SCRAPPY` and an `onDeathEffect`.** Scrappy
>     vehicles auto-repair in the 80–89.999% band with no player prompt, so a beneficial
>     death trigger on a Scrappy card would be silently unreachable. (Loggerhead hit this
>     and had `SCRAPPY` removed.)

Replace it with:

```markdown
10. **`SCRAPPY` narrows an `onDeathEffect`'s window — it does not close it.**
    `autoRepairIds` (`shared/engine/battleResolve.ts`) repairs a Scrappy hull
    only when `REPAIR_WINDOW_MIN_PERCENT <= hp < SURVIVE_HP_PERCENT`
    (80–89.999%). Below 80% the hull is not repaired: it is removed from its
    zone, discarded and pushed to `destroyedEntries`, which is exactly what
    dispatches `onDeathEffect`. So the combination is **allowed**, and a card
    may carry both — SS Argonaut does, deliberately (2026-09-02 spec R-4).

    ⚠ This rule previously claimed such a trigger was "silently unreachable".
    That was wrong, and it cost Loggerhead its `SCRAPPY` keyword. Loggerhead
    has not been reverted: restoring it is a balance decision, not a
    correction. What survives of the original warning is only this — weigh
    whether a *beneficial* death trigger is worth having on a hull that
    survives the 80–90% band for free.
```

- [ ] **Step 2: Run the full suite and record the count**

```bash
npx vitest run
```

Write down the passing count. Compare it to the count from before Task 1 — if
you did not record that, get it with `git stash` on a clean tree, or from the
last merged commit's message. **Report both numbers**; "tests pass" is not a
verification.

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc -p tsconfig.json --noEmit
```

Expected: clean. If this reports errors in the hundreds, suspect incomplete
`node_modules` before suspecting the code — run `npm install` in both the repo
root and `frontend/`.

```bash
npm --prefix frontend run build
```

Expected: clean.

- [ ] **Step 4: Confirm the function payload is in sync**

```bash
npm run functions:sync
git status --short supabase/functions
```

Expected: no changes. A non-empty result means a `shared/` edit in Tasks 1-2
was committed without its sync, and `functionSharedSync.test.ts` would have
caught it — commit the sync now.

- [ ] **Step 5: Commit**

```bash
git add docs/claude/card-effects.md
git commit -m "docs: rule 10 was wrong — Scrappy narrows a death trigger, it does not block one"
```

---

## Wave close-out

Before opening the PR, confirm each of these and say so explicitly:

- [ ] `KNOWN_GAPS` in `supabase/seed/effectCoverage.test.ts` is still **empty**
      (spec §1.1). This wave seeds no new card, so it must be.
- [ ] `DELIBERATE_ORPHANS` is **unchanged**. The three retirement-caused
      "orphans" are not orphans — the retired cards still name their effects
      (spec §5), and adding an entry would trip the map's stale-entry
      assertion.
- [ ] `npm run seed:build` output is committed and `seedDataSync.test.ts` passes.
- [ ] Suite before→after passing counts reported.
- [ ] Name what this wave did **not** do: the five faction waves are untouched,
      and no card's costs, keywords or text have moved yet.

## Deploy note

Merging to `main` deploys automatically via the Supabase GitHub integration,
which runs migrate → seed → deploy. This wave adds **no migration** — `retired`
is a jsonb meta key on an existing column, so the seed step alone applies it.

⚠ **This wave is what breaks the 25 affected decks**, by design and with the
affordance shipped in the same deploy (spec §2.2). Their owners can still
finish any game already in progress; they cannot start a new lobby with an
affected deck until they edit it.
