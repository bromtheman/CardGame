# Playtest Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four UX/rules problems from the first playtest — a hand that scrolls, an invisible resource count, repair decisions made by the wrong player, and a deck that dies when it empties.

**Architecture:** Four independent slices. Two are pure frontend (`HandBar` fan layout driven by a new tested pure module; `GameBoardPage` sticky resource HUD). Two are engine changes in `shared/` that flow into the `game-action` edge function (`drawCard` reshuffles from `state.destroyed`, which is already a discard pile; battle repairs split so each side chooses only for its own vehicles, with Scrappy auto-repaired by the engine). One seed-data change drops `SCRAPPY` from Loggerhead so the auto-repair rule needs no exception.

**Tech Stack:** TypeScript (strict), React 19 + Vite + Tailwind v4, Vitest, Supabase edge functions (Deno).

**Spec:** [docs/superpowers/specs/2026-08-26-playtest-polish-design.md](../specs/2026-08-26-playtest-polish-design.md)

## Global Constraints

- **Every commit touching `shared/` must include `npm run functions:sync` output.** A drift test (`supabase/seed/functionSharedSync.test.ts`) fails otherwise. This applies to Tasks 4 and 5.
- **Relative imports inside `shared/` require the `.ts` extension** — Deno runs those files verbatim inside edge functions.
- **Consumers import `shared/engine/index.ts`, never individual engine modules.** The index's side-effect imports populate the handler/effect registries.
- **Public `state.log` must never name a card in a hidden hand.** Log lines are visible to both players.
- All randomness goes through `ctx.rng()`; all ids through `ctx.newId()`. `Math.random()` and `crypto.randomUUID()` break determinism in tests.
- Test command is `npx vitest run` from the repo root. **Never pass `--root`** — it silently runs 0 tests.
- Frontend checks: `npm --prefix frontend run build` (typecheck + build) and `npm --prefix frontend run lint` (oxlint).
- Do not implement any of the 65 unimplemented card effects. That is Spec 2 and is out of scope here.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `frontend/src/pages/game/handFanLayout.ts` | **New.** Pure geometry: given a card count and container width, return each card's wrapper position, rotation, and arc drop. No React. | 1 |
| `frontend/src/pages/game/handFanLayout.test.ts` | **New.** Unit tests for the above. | 1 |
| `frontend/src/pages/game/HandBar.tsx` | Renders the fan, owns lift state, drops the Reveal button. Behaviour only — no geometry math. | 2, 3 |
| `frontend/src/pages/game/GameBoardPage.tsx` | Sticky header, split resource groups, owns lifted-card state. | 2, 3 |
| `shared/engine/gameEngine.ts` | `drawCard` gains `ctx` and reshuffles the discard when the deck is empty. | 4 |
| `shared/engine/placement.ts` | New `spendCard` helper; ability play paths route spent cards to the discard. | 4 |
| `shared/engine/heroPowers.ts` | `USE_HERO_POWER` handler gains its `ctx` parameter so it can call the new `drawCard`. | 4 |
| `shared/effects/dwgEffects.ts` | `drawPlusCp` destructures `ctx` to pass to `drawCard`. | 4 |
| `shared/engine/engineTypes.ts` | `DECIDE_BATTLE_REPORT` gains optional `repairs`. | 5 |
| `shared/engine/battleResolve.ts` | Ownership validation on both actions; exported `autoRepairIds`; union repair set. | 5 |
| `frontend/src/pages/game/BattleOverlay.tsx` | Repair column shows checkboxes only for your own vehicles; approver picks their own; Scrappy rows are static. | 6 |
| `supabase/seed/source/builtInCards/DWG-built-in.js` | Loggerhead drops `SCRAPPY`. | 7 |

**Task order matters for two pairs.** Task 2 consumes Task 1's module. Task 6 consumes Task 5's `autoRepairIds` export and the new action shape — and between Tasks 5 and 6 the deployed app would be inconsistent (the old UI can still check an opponent's repair box, which the new engine rejects with a 400). Nothing is deployed until Task 8, so this is safe, but do not deploy mid-sequence.

---

### Task 1: Hand fan geometry module

A pure, dependency-free module so the layout math is tested without rendering React. Lives beside `zoneEffectBadges.ts`, which follows the same "pure module + test next to the component" pattern.

**Files:**
- Create: `frontend/src/pages/game/handFanLayout.ts`
- Test: `frontend/src/pages/game/handFanLayout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CARD_W = 280`, `CARD_H = 430`, `REST_SCALE = 0.75`, `LIFT_PX = 48` (numbers)
  - `RENDERED_CARD_W: number`, `RENDERED_CARD_H: number`
  - `WRAPPER_INSET: number`
  - `interface FanSlot { left: number; angleDeg: number; arcY: number }`
  - `fanStep(count: number, containerWidth: number): number`
  - `fanLayout(count: number, containerWidth: number): FanSlot[]`
  - `fanSpan(count: number, containerWidth: number): number`

**Key subtlety to preserve:** `FanSlot.left` is the **wrapper's** CSS `left`, and the wrapper is a full `CARD_W` (280px) box that is visually scaled to `RENDERED_CARD_W` (210px) about `bottom center`. The rendered card therefore sits `WRAPPER_INSET` (35px) inside its wrapper, so `left` is offset by `-WRAPPER_INSET`. `fanSpan` measures the **rendered** edge-to-edge width, which is what must fit the container. Confusing these two is the exact class of mistake that produced the original scrolling bug.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/game/handFanLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  RENDERED_CARD_W, WRAPPER_INSET, fanLayout, fanSpan, fanStep,
} from './handFanLayout'

const WIDTH = 1104 // max-w-6xl (1152) minus the page's p-6 padding

describe('fanStep', () => {
  it('is zero for an empty or single-card hand', () => {
    expect(fanStep(0, WIDTH)).toBe(0)
    expect(fanStep(1, WIDTH)).toBe(0)
  })
  it('caps the spread on a small hand so it stays a fan, not a spaced-out row', () => {
    // (1104 - 210) / 4 = 223.5 available, but the ratio cap is 0.55 * 210
    expect(fanStep(5, WIDTH)).toBeCloseTo(115.5, 5)
  })
  it('compresses a large hand to exactly fill the container', () => {
    expect(fanStep(12, WIDTH)).toBeCloseTo((WIDTH - RENDERED_CARD_W) / 11, 5)
  })
})

describe('fanSpan', () => {
  it('never exceeds the container width at any hand size', () => {
    for (const n of [1, 2, 3, 5, 8, 12, 20]) {
      expect(fanSpan(n, WIDTH)).toBeLessThanOrEqual(WIDTH + 0.001)
    }
  })
  it('is a single card wide for a one-card hand', () => {
    expect(fanSpan(1, WIDTH)).toBeCloseTo(RENDERED_CARD_W, 5)
  })
  it('cannot shrink below one card even in an impossibly narrow container', () => {
    expect(fanSpan(5, 50)).toBeCloseTo(RENDERED_CARD_W, 5)
  })
})

describe('fanLayout', () => {
  it('returns nothing for an empty hand', () => {
    expect(fanLayout(0, WIDTH)).toEqual([])
  })
  it('centres a single card flat, with no rotation or arc drop', () => {
    expect(fanLayout(1, WIDTH)).toEqual([{ left: -WRAPPER_INSET, angleDeg: 0, arcY: 0 }])
  })
  it('advances left monotonically', () => {
    const slots = fanLayout(7, WIDTH)
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].left).toBeGreaterThan(slots[i - 1].left)
    }
  })
  it('fans symmetrically about the centre', () => {
    const slots = fanLayout(5, WIDTH)
    expect(slots[0].angleDeg).toBeCloseTo(-slots[4].angleDeg, 5)
    expect(slots[1].angleDeg).toBeCloseTo(-slots[3].angleDeg, 5)
    expect(slots[2].angleDeg).toBeCloseTo(0, 5)
  })
  it('drops the outer cards further than the inner ones', () => {
    const slots = fanLayout(5, WIDTH)
    expect(slots[0].arcY).toBeGreaterThan(slots[1].arcY)
    expect(slots[2].arcY).toBeCloseTo(0, 5)
    expect(slots[0].arcY).toBeCloseTo(slots[4].arcY, 5)
  })
  it('offsets every wrapper by the inset so rendered cards start at the container edge', () => {
    expect(fanLayout(4, WIDTH)[0].left).toBeCloseTo(-WRAPPER_INSET, 5)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run frontend/src/pages/game/handFanLayout.test.ts
```

Expected: FAIL — `Failed to resolve import "./handFanLayout"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/pages/game/handFanLayout.ts`:

```ts
// Pure geometry for the fanned hand. No React, no DOM — so the maths that
// decides whether the hand fits on screen is unit-testable on its own.
//
// The original bug this replaces: cards were laid out in a flex row at
// `scale-75`, but `scale` is a transform — it shrinks a card visually while
// its layout box stays CARD_W wide. Four cards filled the container and the
// hand scrolled from the opening draw of five.

export const CARD_W = 280 // PhysicalCard's intrinsic size
export const CARD_H = 430

export const REST_SCALE = 0.75 // resting size of a card in the fan
export const MAX_STEP_RATIO = 0.55 // cap on spread, so a small hand stays a fan
export const DEG_PER_CARD = 4 // ~20° total sweep across five cards
export const ARC_K = 1.6 // px of vertical drop per squared step from centre
export const LIFT_PX = 48 // how far the hovered card rises

export const RENDERED_CARD_W = CARD_W * REST_SCALE // 210
export const RENDERED_CARD_H = CARD_H * REST_SCALE // 322.5

// A card's wrapper is a full CARD_W box scaled about `bottom center`, so the
// rendered card sits this far inside it. Wrapper positions subtract the inset
// so the *rendered* left edge lands where the fan maths intends.
export const WRAPPER_INSET = (CARD_W - RENDERED_CARD_W) / 2 // 35

export interface FanSlot {
  /** CSS `left` for the card's wrapper (already inset-corrected). */
  left: number
  /** Resting rotation in degrees; the lifted card overrides this to 0. */
  angleDeg: number
  /** Downward offset in px, so the fan curves at its edges. */
  arcY: number
}

/** Horizontal advance between adjacent cards, in rendered pixels. */
export function fanStep(count: number, containerWidth: number): number {
  if (count <= 1) return 0
  const available = Math.max(0, containerWidth - RENDERED_CARD_W)
  return Math.min(MAX_STEP_RATIO * RENDERED_CARD_W, available / (count - 1))
}

/**
 * Rendered edge-to-edge width of the whole fan. This is the value that must
 * fit the container — NOT the sum of the wrapper boxes.
 */
export function fanSpan(count: number, containerWidth: number): number {
  if (count <= 0) return 0
  return fanStep(count, containerWidth) * (count - 1) + RENDERED_CARD_W
}

export function fanLayout(count: number, containerWidth: number): FanSlot[] {
  const step = fanStep(count, containerWidth)
  const centre = (count - 1) / 2
  const slots: FanSlot[] = []
  for (let i = 0; i < count; i++) {
    const offset = i - centre
    slots.push({
      left: i * step - WRAPPER_INSET,
      angleDeg: offset * DEG_PER_CARD,
      arcY: offset * offset * ARC_K,
    })
  }
  return slots
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run frontend/src/pages/game/handFanLayout.test.ts
```

Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/game/handFanLayout.ts frontend/src/pages/game/handFanLayout.test.ts
git commit -m "feat(hand): pure fan geometry module with tests"
```

---

### Task 2: Render the fanned hand, drop the Reveal button

**Files:**
- Modify: `frontend/src/pages/game/HandBar.tsx`
- Modify: `frontend/src/pages/game/GameBoardPage.tsx` (stop passing `canReveal`; own the lifted-card state)

**Interfaces:**
- Consumes: `fanLayout`, `RENDERED_CARD_H`, `LIFT_PX`, `CARD_W`, `CARD_H`, `REST_SCALE` from Task 1.
- Produces: `HandBar` prop `onLiftedChange: (card: CardInstance | null) => void`, called whenever the lifted card changes. Task 3 consumes it.

There is no React test harness in this repo, so this task is verified by typecheck, lint, and a browser pass rather than by unit tests.

- [ ] **Step 1: Add imports and lift state to `HandBar.tsx`**

Change the React import on line 1 and add the layout import beneath the existing ones:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
```

```tsx
import {
  CARD_H, CARD_W, LIFT_PX, RENDERED_CARD_H, REST_SCALE, fanLayout,
} from './handFanLayout'
```

- [ ] **Step 2: Replace the `canReveal` prop with `onLiftedChange`**

In the props destructure, replace `canReveal,` with `onLiftedChange,`. In the props type, delete these three lines:

```tsx
  // Reveal (SET_ALERT_CARD) is only meaningful on your own turn with no
  // battle in progress — mirrors GameBoardPage's canActivateZones gate.
  canReveal: boolean
```

and replace with:

```tsx
  // Fires whenever the hovered/focused card changes, so GameBoardPage can
  // tint the materials readout when the lifted card is unaffordable.
  onLiftedChange: (card: CardInstance | null) => void
```

- [ ] **Step 3: Delete the Reveal handler**

Remove the whole `handleReveal` function:

```tsx
  function handleReveal(card: CardInstance) {
    void send({ type: 'SET_ALERT_CARD', instanceId: card.instanceId })
  }
```

`SET_ALERT_CARD` stays in the engine and in `GameAction` — Spec 2 will drive it automatically when a forced-battle card is played. Only the manual button goes.

- [ ] **Step 4: Add lift state and container measurement**

Insert after the existing `useState` declarations:

```tsx
  const [liftedId, setLiftedId] = useState<string | null>(null)
  const fanRef = useRef<HTMLDivElement>(null)
  const [fanWidth, setFanWidth] = useState(0)

  // The fan sizes itself to whatever width it is given, so it must re-measure
  // on resize rather than assume the page's max-width.
  useLayoutEffect(() => {
    const el = fanRef.current
    if (!el) return
    setFanWidth(el.clientWidth)
    const observer = new ResizeObserver(([entry]) => setFanWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A lifted card that leaves the hand (played, or discarded by an effect)
  // must not keep the board's affordability tint alive.
  useEffect(() => {
    if (liftedId !== null && !hand.some((c) => c.instanceId === liftedId)) setLiftedId(null)
  }, [hand, liftedId])

  useEffect(() => {
    onLiftedChange(hand.find((c) => c.instanceId === liftedId) ?? null)
  }, [liftedId, hand, onLiftedChange])

  function lift(id: string) {
    setLiftedId(id)
  }
  function drop(id: string) {
    setLiftedId((current) => (current === id ? null : current))
  }
```

- [ ] **Step 5: Replace the hand container and card wrappers**

Replace the entire `<div className="mt-2 flex gap-2 overflow-x-auto pb-4">` block — from that opening tag through its closing `</div>` (including the `hand.length === 0` empty-state line) — with:

```tsx
      <div
        ref={fanRef}
        className="relative mt-2"
        style={{ height: RENDERED_CARD_H + 16 }}
      >
        {fanLayout(hand.length, fanWidth).map((slot, i) => {
          const c = hand[i]
          const effectiveCost = effectiveCostInGame(state, mySide, c)
          const affordable = state.resources[mySide].materials >= effectiveCost && state.resources[mySide].cp >= c.cpCost
          const selected =
            placingCard?.instanceId === c.instanceId ||
            fieldTargeting?.instanceId === c.instanceId ||
            handTargeting?.instanceId === c.instanceId
          const isHandTarget = handTargeting !== null && c.instanceId !== handTargeting.instanceId
          const lifted = liftedId === c.instanceId
          return (
            <div
              key={c.instanceId}
              tabIndex={0}
              onPointerEnter={() => lift(c.instanceId)}
              onPointerLeave={() => drop(c.instanceId)}
              onFocus={() => lift(c.instanceId)}
              onBlur={() => drop(c.instanceId)}
              style={{
                left: slot.left,
                bottom: lifted ? LIFT_PX : -slot.arcY,
                width: CARD_W,
                height: CARD_H,
                zIndex: lifted ? 50 : i,
                transform: `scale(${lifted ? 1 : REST_SCALE}) rotate(${lifted ? 0 : slot.angleDeg}deg)`,
                transformOrigin: 'bottom center',
              }}
              className={`absolute transition-all duration-150 ease-out focus:outline-none ${
                affordable ? '' : 'opacity-50'
              } ${selected ? 'rounded-xl ring-4 ring-brass-400' : ''}`}
            >
              <PhysicalCard
                card={cardInstanceToRow(c)}
                effectiveCost={effectiveCost}
                onClick={c.type === 'vehicle' ? () => handleVehicleClick(c) : undefined}
              />
              {effectiveCost !== c.materialCost && (
                <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-ocean-900/90 px-2 py-1 text-xs font-bold text-parchment-100">
                  <span className="text-ocean-300 line-through">{shortHandNumber(c.materialCost)}</span>
                  <span>{shortHandNumber(effectiveCost)}</span>
                </span>
              )}
              {/* Actions render only on the lifted card: in a fan every other
                  card's buttons are covered by its neighbour, and rendering
                  them anyway would put unreachable controls in the tab order. */}
              {lifted && isHandTarget && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleHandTargetClick(c)
                  }}
                  className="absolute inset-x-6 top-16 rounded bg-ocean-700 px-2 py-1 text-sm font-bold text-parchment-100 shadow-plank disabled:opacity-50"
                >
                  Target
                </button>
              )}
              {lifted && c.type === 'ability' && (
                <button
                  disabled={busy || !affordable}
                  onClick={() => handleAbilityPlay(c)}
                  className="absolute inset-x-6 bottom-6 rounded bg-brass-400 px-2 py-2 font-bold text-ocean-950 shadow-plank disabled:opacity-50"
                >
                  Play ({shortHandNumber(effectiveCost)})
                </button>
              )}
            </div>
          )
        })}
        {hand.length === 0 && <p className="text-ocean-300">Your hand is empty.</p>}
      </div>
```

- [ ] **Step 6: Update `GameBoardPage.tsx` to match the new props**

Find the `<HandBar` element and replace `canReveal={canActivateZones}` with:

```tsx
          onLiftedChange={setLiftedCard}
```

Add the state declaration alongside the page's other mode state (near `placingCard` / `fieldTargeting`):

```tsx
  const [liftedCard, setLiftedCard] = useState<CardInstance | null>(null)
```

Task 3 consumes `liftedCard`. If `CardInstance` is not already imported in this file, add it to the existing `@shared/engine/gameInit` type import.

- [ ] **Step 7: Typecheck and lint**

```bash
npm --prefix frontend run build
```

Expected: PASS. If it reports `canActivateZones` is now unused, leave it — it still gates other board interactions. If it reports an unused `useState` import in `HandBar`, that means Step 4 was skipped.

```bash
npm --prefix frontend run lint
```

Expected: PASS.

- [ ] **Step 8: Verify in the browser**

Start the preview via the `frontend` entry in `.claude/launch.json`, open a game, and confirm: the hand fans without a horizontal scrollbar; hovering a card raises and straightens it; only the raised card shows its buttons; no Reveal button appears anywhere. Take a screenshot for the review.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/game/HandBar.tsx frontend/src/pages/game/GameBoardPage.tsx
git commit -m "feat(hand): fanned hand with hover lift; drop the manual Reveal button"
```

---

### Task 3: Sticky, prominent resource readout

**Files:**
- Modify: `frontend/src/pages/game/GameBoardPage.tsx`

**Interfaces:**
- Consumes: `liftedCard` state from Task 2; `effectiveCostInGame` (already imported in this file's sibling modules — add the import if absent).
- Produces: nothing downstream.

- [ ] **Step 1: Make the header sticky**

Replace the opening `<header ...>` tag:

```tsx
      <header className="flex flex-wrap items-center justify-between gap-3 rounded border border-ocean-600 bg-ocean-900/60 p-4">
```

with:

```tsx
      {/* Sticky because the board is taller than a viewport: the resource
          figures were scrolling out of view at exactly the moment a player
          looks at their hand to decide what they can afford. z-20 keeps it
          under the lifted hand card (z-50), so a raised card passes over it. */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded border border-ocean-600 bg-ocean-900/95 p-4 backdrop-blur">
```

- [ ] **Step 2: Split your resources from the opponent's counts**

Replace this block:

```tsx
        <div className="flex flex-wrap gap-4 text-sm text-ocean-300">
          <span className="flex items-center gap-1">
            <img src={ironIcon} alt="materials" className="h-4 w-4" />
            {shortHandNumber(state.resources[mySide].materials)}
          </span>
          <span>CP: {state.resources[mySide].cp}</span>
          <span>Opponent hand: {state.counts[theirSide].hand}</span>
          <span>Opponent deck: {state.counts[theirSide].deck}</span>
        </div>
```

with:

```tsx
        <div className="flex flex-wrap items-center gap-5">
          <span
            className={`flex items-center gap-2 text-2xl font-bold ${
              liftedUnaffordable ? 'text-red-400' : 'text-brass-400'
            }`}
            title={`${state.resources[mySide].materials.toLocaleString()} materials`}
          >
            <img src={ironIcon} alt="materials" className="h-6 w-6" />
            {shortHandNumber(state.resources[mySide].materials)}
          </span>
          <span className="text-2xl font-bold text-brass-400">
            {state.resources[mySide].cp}
            <span className="ml-1 text-sm font-normal text-ocean-300">CP</span>
          </span>
          <span className="flex flex-col border-l border-ocean-600 pl-5 text-xs text-ocean-400">
            <span>Opponent hand: {state.counts[theirSide].hand}</span>
            <span>Opponent deck: {state.counts[theirSide].deck}</span>
          </span>
        </div>
```

- [ ] **Step 3: Compute the affordability tint**

Add above the `return (` of the component, next to the other derived values:

```tsx
  // Tint the materials figure when the card currently raised in the hand is
  // out of reach — it answers "can I play this?" at the moment it is asked.
  const liftedUnaffordable =
    liftedCard !== null &&
    state.resources[mySide].materials < effectiveCostInGame(state, mySide, liftedCard)
```

Add `effectiveCostInGame` to the existing `@shared/engine/index` import if it is not already there.

- [ ] **Step 4: Typecheck and lint**

```bash
npm --prefix frontend run build
```

Expected: PASS.

```bash
npm --prefix frontend run lint
```

Expected: PASS.

- [ ] **Step 5: Verify in the browser**

Scroll the board down to the hand and confirm the header stays pinned with the materials figure legible. Hover a card you cannot afford and confirm the materials figure turns red; hover an affordable one and confirm it returns to brass. Confirm a lifted card passes *over* the header rather than under it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/game/GameBoardPage.tsx
git commit -m "feat(board): sticky header with prominent own-resource readout"
```

---

### Task 4: Deck-out reshuffle

**Files:**
- Modify: `shared/engine/gameEngine.ts` (`drawCard`, ~line 83; caller at ~line 129)
- Modify: `shared/engine/placement.ts` (new `spendCard`; four call sites)
- Modify: `shared/engine/heroPowers.ts` (~line 111 handler signature; caller ~line 146)
- Modify: `shared/effects/dwgEffects.ts` (`drawPlusCp`, ~line 9)
- Test: `shared/engine/gameEngine.test.ts`

**Interfaces:**
- Consumes: `EngineContext` (existing).
- Produces:
  - `drawCard(game: EngineGame, side: Side, ctx: EngineContext): void` — **signature change**, `ctx` is required.
  - `spendCard(game: EngineGame, side: Side, card: CardInstance): void` exported from `placement.ts`.

**Two subtleties that must survive implementation:**

1. `state.destroyed` already *is* a discard pile — the Salvage hero power splices cards out of it, and both Change Order and temporary-despawn already push into it. This task adds spent abilities and the reshuffle; it does not add a new state key, so games already in progress need no migration.
2. `spendCard` must be called **after** `resolvePlayEffects` succeeds, never before. `applyAction` runs on a `structuredClone`, so a failed action rolls back regardless — but if the card entered the discard first, a card that draws from an empty deck could shuffle *itself* back into the deck mid-resolution.

- [ ] **Step 1: Write the failing tests**

Append to `shared/engine/gameEngine.test.ts`:

```ts
describe('deck-out reshuffle', () => {
  it('shuffles the discard back into an empty deck and draws from it', () => {
    const g = makeGame({ activePlayer: 'alice' })
    g.privates.b.deck = []
    g.state.destroyed.b = [snap({ name: 'Salvaged Hull' }), snap({ name: 'Spent Order' })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand).toHaveLength(1)
    expect(r.game.privates.b.deck).toHaveLength(1)
    expect(r.game.state.destroyed.b).toEqual([])
    expect(r.game.state.counts.b).toEqual({ hand: 1, deck: 1 })
    expect(r.game.state.log.some((l) => l.includes('reshuffles 2 card(s)'))).toBe(true)
  })

  it('gives every reshuffled card a fresh instance id', () => {
    const g = makeGame({ activePlayer: 'alice' })
    g.privates.b.deck = []
    g.state.destroyed.b = [snap({ name: 'A' }), snap({ name: 'B' })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    const ids = [...r.game.privates.b.hand, ...r.game.privates.b.deck].map((c) => c.instanceId)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  })

  it('logs and does not throw when both deck and discard are empty', () => {
    const g = makeGame({ activePlayer: 'alice' })
    g.privates.b.deck = []
    g.state.destroyed.b = []
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand).toEqual([])
    expect(r.game.state.log.some((l) => l.includes('no cards left to draw'))).toBe(true)
  })

  it('does not reshuffle while the deck still has cards', () => {
    const g = makeGame({ activePlayer: 'alice' })
    g.privates.b.deck = [inst({ name: 'Top Card' })]
    g.state.destroyed.b = [snap({ name: 'Stays Discarded' })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand[0].name).toBe('Top Card')
    expect(r.game.state.destroyed.b).toHaveLength(1)
  })
})

describe('spent ability cards', () => {
  it('sends a played ability card to its owner discard', () => {
    const g = makeGame({ activePlayer: 'alice' })
    const ability = inst({ type: 'ability', name: 'Some Order', materialCost: 0, cardText: '' })
    g.privates.a.hand = [ability]
    g.state.counts.a.hand = 1
    const r = applyAction(g, 'alice', {
      type: 'PLAY_ABILITY_CARD', instanceId: ability.instanceId,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a.map((c) => c.name)).toContain('Some Order')
    expect(r.game.privates.a.hand).toEqual([])
  })

  it('does not discard a vehicle played to a zone — it is on the field', () => {
    const g = makeGame({ activePlayer: 'alice' })
    const vehicle = inst({ name: 'Hull', materialCost: 0, vehicleType: 'ship' })
    g.privates.a.hand = [vehicle]
    g.state.counts.a.hand = 1
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TO_ZONE', instanceId: vehicle.instanceId, zoneId: 1,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a).toEqual([])
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
  })
})
```

This file currently imports `{ inst, makeGame, zoneEntry }` from `./testFixtures`. Widen it to:

```ts
import { inst, makeCtx, makeGame, snap, zoneEntry } from './testFixtures'
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run shared/engine/gameEngine.test.ts
```

Expected: FAIL — the reshuffle tests find an empty hand, and the ability test finds an empty `destroyed`.

- [ ] **Step 3: Add the reshuffle to `drawCard`**

In `shared/engine/gameEngine.ts`, replace `drawCard` (~line 83) with:

```ts
// The discard (state.destroyed) recycles into the deck the moment a draw
// would otherwise fail — lazily, never eagerly when the deck hits zero.
// SnapshotCard carries no instanceId, so each returning card is minted a
// fresh one, exactly as loggerheadOnDeath does.
function reshuffleDiscard(game: EngineGame, side: Side, ctx: EngineContext): void {
  const pile = game.state.destroyed[side]
  if (pile.length === 0) return
  const returning = pile.map((card) => ({ ...card, instanceId: ctx.newId() }))
  game.state.destroyed[side] = []
  for (let i = returning.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[returning[i], returning[j]] = [returning[j], returning[i]]
  }
  game.privates[side].deck.push(...returning)
  game.state.log.push(
    `Player ${side.toUpperCase()} reshuffles ${returning.length} card(s) from the discard into their deck`,
  )
}

export function drawCard(game: EngineGame, side: Side, ctx: EngineContext): void {
  const priv = game.privates[side]
  if (priv.deck.length === 0) reshuffleDiscard(game, side, ctx)
  const card = priv.deck.shift()
  if (!card) {
    game.state.log.push(`Player ${side.toUpperCase()} has no cards left to draw`)
  } else {
    priv.hand.push(card)
  }
  game.state.counts[side] = { hand: priv.hand.length, deck: priv.deck.length }
}
```

`EngineContext` is already imported in this file. Update the caller at ~line 129 inside `endTurn`:

```ts
  drawCard(game, side, ctx)
```

- [ ] **Step 4: Thread `ctx` through the other two callers**

In `shared/engine/heroPowers.ts`, add the `ctx` parameter to the handler at ~line 111:

```ts
registerHandler('USE_HERO_POWER', (game, actor, action, ctx) => {
```

and update the call at ~line 146:

```ts
      drawCard(game, actor, ctx)
```

In `shared/effects/dwgEffects.ts`, destructure `ctx` in `drawPlusCp` (~line 9):

```ts
const drawPlusCp = ({ game, actor, ctx }: EffectPayload): boolean => {
  drawCard(game, actor, ctx)
  game.state.resources[actor].cp += 1
  return true
}
```

- [ ] **Step 5: Add `spendCard` and route the ability paths through it**

In `shared/engine/placement.ts`, add beside `takeFromHand` (~line 68):

```ts
// An ability card is spent once it resolves: it leaves play into its owner's
// discard (state.destroyed), which drawCard reshuffles when the deck runs
// out. Call this AFTER effects resolve — a card that draws from an empty deck
// must not be able to shuffle itself back in mid-resolution.
export function spendCard(game: EngineGame, side: Side, card: CardInstance): void {
  const { instanceId: _instanceId, ...snapshot } = card
  game.state.destroyed[side].push(snapshot)
}
```

Then add a `spendCard` call after the successful `resolvePlayEffects` in each of the four play paths.

In `PLAY_CARD_TO_ZONE` (~line 145) — abilities only, because a vehicle goes to the field:

```ts
  const failure = resolvePlayEffects(
    game, actor, card, ctx, { targetZoneId: action.zoneId }, ['playOnZoneEffect', 'onPlayEffect'],
  )
  if (failure) return failure
  if (card.type !== 'vehicle') spendCard(game, actor, card)
```

In `PLAY_ABILITY_CARD`, `PLAY_CARD_TARGETING_CARD_ON_FIELD`, and `PLAY_CARD_TARGETING_CARD_IN_HAND`, add immediately after each handler's `if (failure) return failure`:

```ts
  spendCard(game, actor, card)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run
```

Expected: PASS across the whole suite. Existing `drawCard` callers in tests may need the new third argument — pass `makeCtx()`.

- [ ] **Step 7: Sync the edge-function copy of `shared/`**

```bash
npm run functions:sync
```

This is mandatory in the same commit — `supabase/seed/functionSharedSync.test.ts` fails otherwise.

- [ ] **Step 8: Typecheck**

```bash
npx tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add shared/ supabase/functions/ 
git commit -m "feat(engine): recycle the discard into an empty deck; spent abilities now discard"
```

---

### Task 5: Repair ownership and Scrappy auto-repair (engine)

**Files:**
- Modify: `shared/engine/engineTypes.ts:70`
- Modify: `shared/engine/battleResolve.ts`
- Test: `shared/engine/battleResolve.test.ts`

**Interfaces:**
- Consumes: `participantsOf` (module-private), `repairCostOf` (already exported).
- Produces:
  - `DECIDE_BATTLE_REPORT` action gains optional `repairs?: string[]`.
  - `autoRepairIds(participants: { entry: { instanceId: string; keywords: string[] }; side: Side }[], results: Record<string, number>): string[]` — exported, consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `shared/engine/battleResolve.test.ts`. Note `alice` is side `a` and `bob` is side `b`; `inBattle()` gives `atk` to side `a` and `def` to side `b`.

```ts
describe('repair ownership', () => {
  it('rejects a submitter who tries to repair the other captain\'s vehicle', () => {
    const { g, atk, def } = inBattle()
    expect(applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 85 },
      repairs: [def.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
  })

  it('accepts a submitter repairing their own vehicle', () => {
    const { g, atk, def } = inBattle()
    const r = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 },
      repairs: [atk.instanceId],
    })
    expect(r.ok).toBe(true)
  })

  it('lets the approver repair their own vehicle at decision time', () => {
    const { g, atk, def } = inBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 95, [def.instanceId]: 85 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', {
      type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [def.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.b).toHaveLength(1)
    expect(r.game.state.resources.b.materials).toBe(100000 - repairCostOf(def))
  })

  it('rejects an approver repairing the submitter\'s vehicle', () => {
    const { g, atk, def } = inBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    expect(applyAction(submitted.game, 'bob', {
      type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [atk.instanceId],
    })).toMatchObject({ ok: false, status: 400 })
  })

  it('ignores a repairs array sent alongside a rejection', () => {
    const { g, atk, def } = inBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', {
      type: 'DECIDE_BATTLE_REPORT', approve: false, repairs: [atk.instanceId],
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingReport).toBeNull()
  })
})

describe('Scrappy auto-repair', () => {
  function scrappyBattle() {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({ playedOnTurn: 2, materialCost: 40000, name: 'Raider', keywords: ['scrappy'] })
    const def = zoneEntry({ materialCost: 60000, name: 'Bastion' })
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
      defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
    }
    g.state.zones[0].lastActivatedTurn = 3
    return { g, atk, def }
  }

  it('survives an in-band Scrappy vehicle nobody listed, for free', () => {
    const { g, atk, def } = scrappyBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
    expect(r.game.state.resources.a.materials).toBe(100000)
  })

  it('charges nothing extra when the Scrappy vehicle was also listed explicitly', () => {
    const { g, atk, def } = scrappyBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [atk.instanceId],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.a.materials).toBe(100000)
  })

  it('never auto-repairs a Fragile vehicle', () => {
    const g = makeGame({ turnNumber: 3 })
    const atk = zoneEntry({
      playedOnTurn: 2, materialCost: 40000, name: 'Blimp', keywords: ['scrappy', 'fragile'],
    })
    const def = zoneEntry({ materialCost: 60000, name: 'Bastion' })
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
      defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
    }
    g.state.zones[0].lastActivatedTurn = 3
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 85, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toEqual([])
  })

  it('does not auto-repair a Scrappy vehicle outside the band', () => {
    const { g, atk, def } = scrappyBattle()
    const submitted = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 70, [def.instanceId]: 95 }, repairs: [],
    })
    if (!submitted.ok) throw new Error(submitted.error)
    const r = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toEqual([])
  })
})
```

Add `makeGame` and `zoneEntry` to the existing `./testFixtures` import if not already present.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run shared/engine/battleResolve.test.ts
```

Expected: FAIL — ownership is not enforced, `repairs` is not accepted on the decision, and Scrappy is not auto-repaired.

- [ ] **Step 3: Widen the action type**

In `shared/engine/engineTypes.ts`, replace line 70:

```ts
  | { type: 'DECIDE_BATTLE_REPORT'; approve: boolean; repairs?: string[] }
```

- [ ] **Step 4: Add `autoRepairIds` to `battleResolve.ts`**

Add below `repairCostOf`:

```ts
// Scrappy vehicles repair for free, so the engine applies it unconditionally
// rather than asking — there is no decision to make when the cost is zero.
// Fragile can never repair, and the band still gates everything. Exported so
// BattleOverlay previews exactly what the engine will do.
export function autoRepairIds(
  participants: { entry: { instanceId: string; keywords: string[] }; side: Side }[],
  results: Record<string, number>,
): string[] {
  const ids: string[] = []
  for (const { entry } of participants) {
    const hp = results[entry.instanceId]
    if (hp === undefined) continue
    if (hp < REPAIR_WINDOW_MIN_PERCENT || hp >= SURVIVE_HP_PERCENT) continue
    if (entry.keywords.includes(KEYWORDS.FRAGILE)) continue
    if (!entry.keywords.includes(KEYWORDS.SCRAPPY)) continue
    ids.push(entry.instanceId)
  }
  return ids
}
```

- [ ] **Step 5: Enforce ownership on submission**

In the `SUBMIT_BATTLE_REPORT` handler, inside the `for (const id of action.repairs)` loop, add the ownership check immediately after the existing `if (!participant)` line:

```ts
    if (participant.side !== actor) {
      return err(400, `${participant.entry.name} is not yours to repair — its captain decides`)
    }
```

- [ ] **Step 6: Accept the approver's repairs and apply auto-repair**

In the `DECIDE_BATTLE_REPORT` handler, replace everything from `const participants = participantsOf(game)` down to and including the closing brace of the `for (const side of ['a', 'b'] as Side[]) game.state.resources[side].materials -= owed[side]` line with:

```ts
  const participants = participantsOf(game)
  const roster = [...participants.values()]

  // Each side chooses only for its own vehicles: the submitter's picks came
  // with the report, the approver's arrive with the decision.
  const approverRepairs = Array.isArray(action.repairs) ? action.repairs : []
  for (const id of approverRepairs) {
    const p = participants.get(id)
    if (!p) return err(400, 'Repair selection includes a non-participant')
    if (p.side !== actor) return err(400, `${p.entry.name} is not yours to repair — its captain decides`)
    const hp = report.results[id]
    if (hp === undefined || hp < REPAIR_WINDOW_MIN_PERCENT || hp >= SURVIVE_HP_PERCENT) {
      return err(400, `${p.entry.name} is not in the repairable band`)
    }
    if (p.entry.keywords.includes(KEYWORDS.FRAGILE)) {
      return err(400, `${p.entry.name} is Fragile and cannot be repaired`)
    }
  }

  // A Set both unions the two sides' picks and makes an explicitly-listed
  // Scrappy vehicle redundant rather than double-charged.
  const repairIds = new Set([
    ...report.repairs,
    ...approverRepairs,
    ...autoRepairIds(roster, report.results),
  ])

  // Repair affordability first (all-or-nothing), per owner.
  const owed: Record<Side, number> = { a: 0, b: 0 }
  for (const id of repairIds) {
    const p = participants.get(id)
    if (p) owed[p.side] += repairCostOf(p.entry)
  }
  for (const side of ['a', 'b'] as Side[]) {
    if (owed[side] > game.state.resources[side].materials) {
      return err(400, `Player ${side.toUpperCase()} cannot afford their repairs — reject and resubmit`)
    }
  }
  for (const side of ['a', 'b'] as Side[]) game.state.resources[side].materials -= owed[side]
```

Then in the participant loop below, replace both uses of `report.repairs.includes(id)` with `repairIds.has(id)`:

```ts
    const survives = hp >= SURVIVE_HP_PERCENT ||
      (hp >= REPAIR_WINDOW_MIN_PERCENT && repairIds.has(id))
```

```ts
    } else if (repairIds.has(id)) {
      game.state.log.push(`${entry.name} was repaired (${hp}%)`)
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run
```

Expected: PASS across the whole suite.

- [ ] **Step 8: Sync and typecheck**

```bash
npm run functions:sync
```

```bash
npx tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add shared/ supabase/functions/
git commit -m "feat(battle): each captain repairs only their own vehicles; Scrappy auto-repairs"
```

---

### Task 6: Battle report UI for repair ownership

**Files:**
- Modify: `frontend/src/pages/game/BattleOverlay.tsx`

**Interfaces:**
- Consumes: `autoRepairIds` from Task 5 (via `@shared/engine/index`); `DECIDE_BATTLE_REPORT` with optional `repairs`.
- Produces: nothing downstream.

- [ ] **Step 1: Import `autoRepairIds`**

Extend the existing import on line 4:

```tsx
import { autoRepairIds, effectiveMaterialCostOf, otherSide, repairCostOf } from '@shared/engine/index'
```

No barrel change is needed: `shared/engine/index.ts` already does `export * from './battleResolve.ts'`, so Task 5's new export flows through automatically.

- [ ] **Step 2: Teach `outcomeLabel` about auto-repair**

Replace the function at line 33:

```tsx
function outcomeLabel(
  entry: ZoneCardEntry, hp: number, repaired: boolean, auto: boolean,
): { label: string; survives: boolean } {
  if (hp >= SURVIVE_HP_PERCENT) return { label: 'Survives', survives: true }
  if (hp >= REPAIR_WINDOW_MIN_PERCENT && auto) {
    return { label: 'Auto-repaired (free) — survives', survives: true }
  }
  if (hp >= REPAIR_WINDOW_MIN_PERCENT && repaired) {
    return { label: `Repaired — survives (${shortHandNumber(repairCostOf(entry))})`, survives: true }
  }
  return { label: 'Destroyed', survives: false }
}
```

The only changes from the current version are the `auto` parameter and its branch, placed *before* the manual-repair branch.

- [ ] **Step 3: Restrict the report form's repair column to your own vehicles**

In `ReportForm`, add `mySide` to both the props destructure and the props type:

```tsx
  participants, results, repairs, state, mySide, busy, onHpChange, onToggleRepair, onSubmit,
```

```tsx
  mySide: Side
```

Inside the `participants.map`, replace the `repairable` line and the whole `<td className="py-1">` repair cell with:

```tsx
            const mine = side === mySide
            const auto = inBand && !fragile && entry.keywords.includes(KEYWORDS.SCRAPPY)
            const repairable = inBand && !fragile && mine && !auto
```

```tsx
                <td className="py-1">
                  {auto ? (
                    <span className="text-xs text-brass-400">Auto-repaired (free)</span>
                  ) : !mine ? (
                    <span className="text-xs text-ocean-400">Their captain decides</span>
                  ) : (
                    <label className={`flex items-center gap-1 ${repairable ? '' : 'opacity-40'}`}>
                      <input
                        type="checkbox"
                        disabled={!repairable}
                        checked={repairs.includes(entry.instanceId)}
                        onChange={() => onToggleRepair(entry.instanceId)}
                      />
                      <span className={`text-xs ${affordable ? 'text-ocean-300' : 'text-red-400'}`}>
                        {shortHandNumber(cost)} ({side.toUpperCase()} pays{affordable ? '' : ' — cannot afford'})
                      </span>
                    </label>
                  )}
                </td>
```

No import change is needed here — `KEYWORDS`, `REPAIR_WINDOW_MIN_PERCENT`, and `SURVIVE_HP_PERCENT` are all already imported by this file, as are `Side` and `useState`.

- [ ] **Step 4: Let the approver pick their own repairs**

Replace `DecisionPanel`'s signature and body header:

```tsx
function DecisionPanel({
  participants, report, state, mySide, busy, onDecide,
}: {
  participants: Participant[]
  report: Report
  state: PublicGameState
  mySide: Side
  busy: boolean
  onDecide: (approve: boolean, repairs: string[]) => void
}) {
  const [myRepairs, setMyRepairs] = useState<string[]>([])
  const auto = autoRepairIds(participants, report.results)
  const owed: Record<Side, number> = { a: 0, b: 0 }
  for (const id of new Set([...report.repairs, ...myRepairs, ...auto])) {
    const p = participants.find((x) => x.entry.instanceId === id)
    if (p) owed[p.side] += repairCostOf(p.entry)
  }
```

Replace the `<li>` body inside the participants map so your own repairable vehicles carry a checkbox:

```tsx
        {participants.map(({ entry, side }) => {
          const hp = report.results[entry.instanceId] ?? 0
          const isAuto = auto.includes(entry.instanceId)
          const repaired = report.repairs.includes(entry.instanceId) || myRepairs.includes(entry.instanceId)
          const { label, survives } = outcomeLabel(entry, hp, repaired, isAuto)
          const inBand = hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT
          const canChoose =
            side === mySide && inBand && !isAuto && !entry.keywords.includes(KEYWORDS.FRAGILE)
          return (
            <li key={entry.instanceId} className="flex items-center justify-between rounded border border-ocean-600 bg-ocean-950/60 px-2 py-1">
              <span className="text-parchment-100">{entry.name} — {hp}%</span>
              <span className="flex items-center gap-3">
                {canChoose && (
                  <label className="flex items-center gap-1 text-xs text-ocean-300">
                    <input
                      type="checkbox"
                      checked={myRepairs.includes(entry.instanceId)}
                      onChange={() =>
                        setMyRepairs((rs) =>
                          rs.includes(entry.instanceId)
                            ? rs.filter((x) => x !== entry.instanceId)
                            : [...rs, entry.instanceId],
                        )
                      }
                    />
                    Repair ({shortHandNumber(repairCostOf(entry))})
                  </label>
                )}
                <span className={survives ? 'text-brass-400' : 'text-red-400'}>{label}</span>
              </span>
            </li>
          )
        })}
```

Update both decision buttons to pass the picks:

```tsx
          onClick={() => onDecide(false, [])}
```

```tsx
          onClick={() => onDecide(true, myRepairs)}
```

- [ ] **Step 5: Update the parent component's wiring**

In `BattleOverlay`, replace `onDecide`:

```tsx
  async function onDecide(approve: boolean, decidedRepairs: string[]) {
    await send({ type: 'DECIDE_BATTLE_REPORT', approve, repairs: decidedRepairs })
  }
```

Restrict the submitter's own picks in `onSubmitReport` so the UI cannot send something the engine will reject:

```tsx
  async function onSubmitReport() {
    const validRepairs = repairs.filter((id) => {
      const p = participants.find((x) => x.entry.instanceId === id)
      if (!p || p.side !== mySide) return false
      const hp = results[id] ?? 0
      return hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT && !p.entry.keywords.includes(KEYWORDS.FRAGILE)
    })
    await send({ type: 'SUBMIT_BATTLE_REPORT', results, repairs: validRepairs })
  }
```

Pass `mySide` into both panels at the render switch:

```tsx
            <DecisionPanel participants={participants} report={report} state={state} mySide={mySide} busy={busy} onDecide={onDecide} />
```

```tsx
          <ReportForm
            participants={participants}
            results={results}
            repairs={repairs}
            state={state}
            mySide={mySide}
            busy={busy}
            onHpChange={onHpChange}
            onToggleRepair={onToggleRepair}
            onSubmit={onSubmitReport}
          />
```

Also update `WaitingNotice`'s repair suffix so it does not claim a repair the submitter never requested — it only ever shows the submitter's own picks, which is correct as written; leave it unchanged.

- [ ] **Step 6: Typecheck and lint**

```bash
npm --prefix frontend run build
```

Expected: PASS.

```bash
npm --prefix frontend run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/game/BattleOverlay.tsx
git commit -m "feat(battle-ui): own-vehicle repair choices for both captains"
```

---

### Task 7: Loggerhead drops Scrappy

Loggerhead is the only card that is both Scrappy and carries a beneficial death trigger, which would make unconditional auto-repair silently deny its owner a real choice. Dropping `SCRAPPY` makes the rule unconditional. Its repair cost becomes 17,500 — 70,000 base, halved by Half-Cost, halved again by `REPAIR_COST_RATE`.

**Files:**
- Modify: `supabase/seed/source/builtInCards/DWG-built-in.js:190`
- Regenerate: `supabase/seed/seed_data.sql`

- [ ] **Step 1: Drop the keyword**

In `supabase/seed/source/builtInCards/DWG-built-in.js`, in the `Loggerhead` entry, replace:

```js
        keywords: [KEYWORDS.SCRAPPY, KEYWORDS.HALF_COST],
```

with:

```js
        keywords: [KEYWORDS.HALF_COST],
```

- [ ] **Step 2: Check no test depends on Loggerhead being Scrappy**

```bash
grep -rn "Loggerhead" --include=*.ts shared supabase
```

Expected: matches in `shared/effects/dwgEffects.ts` (the effect itself) and possibly `dwgEffects.test.ts`. If a test constructs a Loggerhead fixture with `scrappy`, that fixture is testing the death effect, not the keyword — leave it, but confirm it still passes in Step 4.

- [ ] **Step 3: Regenerate the seed**

```bash
npm run seed:build
```

Expected: `Wrote 120 cards + N hero powers to .../seed_data.sql`.

- [ ] **Step 4: Run the suite**

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed/source/builtInCards/DWG-built-in.js supabase/seed/seed_data.sql
git commit -m "balance(dwg): Loggerhead drops Scrappy so auto-repair needs no exception"
```

---

### Task 8: Spec amendments, deploy, and end-to-end verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` (§3 deck-out, §3.7 Fragile)
- Modify: `docs/claude/card-effects.md` (record the Scrappy/onDeath invariant)

- [ ] **Step 1: Amend the binding spec**

In `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md`, find the §3 turn-sequence line containing `(both sides), then the active player draws 1 (empty deck → no draw, no penalty)` and replace the parenthetical with:

```
(empty deck → shuffle your discard into your deck and draw; if both are empty, no draw, no penalty)
```

In §3.7, replace `**Fragile** (auto-assigned to airships)` with:

```
**Fragile** (auto-assigned to player-made airships; hand-assigned on built-ins as a balance lever)
```

- [ ] **Step 2: Record the invariant for Spec 2**

In `docs/claude/card-effects.md`, under "Adding a new effect — checklist", add:

```markdown
10. **A built-in card must not carry both `SCRAPPY` and an `onDeathEffect`.** Scrappy
    vehicles auto-repair in the 80–89.999% band with no player prompt, so a beneficial
    death trigger on a Scrappy card would be silently unreachable. (Loggerhead hit this
    and had `SCRAPPY` removed.)
```

- [ ] **Step 3: Verify the whole suite and both frontend checks**

```bash
npx vitest run
```

```bash
npm --prefix frontend run build
```

```bash
npm --prefix frontend run lint
```

```bash
npx tsc -p tsconfig.json --noEmit
```

All four must pass before deploying.

- [ ] **Step 4: Confirm the function sync is clean**

```bash
npm run functions:sync
git status --porcelain supabase/functions
```

Expected: no output from `git status` — Tasks 4 and 5 already committed the synced copies. Any diff here means a sync was missed; commit it before deploying.

- [ ] **Step 5: Apply the seed and deploy**

Apply the regenerated `supabase/seed/seed_data.sql` to the remote project (ref `wpgsjnjnvykxavaxibld`) and deploy the `game-action` edge function, both via the Supabase MCP tools. See [docs/claude/supabase.md](../../claude/supabase.md) for the sequencing — there is no local Supabase stack.

- [ ] **Step 6: End-to-end smoke against the live backend**

In a real game: confirm the hand fans and lifts; confirm the sticky header keeps materials visible while looking at the hand; play an ability card and confirm the log shows it resolving; draw down a deck to empty and confirm the reshuffle line appears; run a battle where each side has a vehicle in the 80–89% band and confirm each captain sees a checkbox only for their own, and that a Scrappy vehicle shows "Auto-repaired (free)" with no toggle.

- [ ] **Step 7: Commit**

```bash
git add docs/
git commit -m "docs: amend spec for discard recycling and airship Fragile ruling"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 Fanned hand — geometry, step formula, constants | 1 |
| §3 Fanned hand — lift interaction, actions on lifted card only, tabIndex | 2 |
| §4 Resource readout — sticky, split groups, affordability tint | 2 (state), 3 (render) |
| §5 Repair ownership — submit validation, approver repairs, union | 5 |
| §5 Scrappy auto-repair — engine-side, `autoRepairIds` shared with UI | 5 (engine), 6 (UI) |
| §5 Loggerhead drops Scrappy + reseed | 7 |
| §5 Scrappy/onDeath invariant recorded | 8 |
| §6 Deck-out reshuffle — lazy, whole pile, fresh ids, counts | 4 |
| §6 Spent abilities enter the discard | 4 |
| §6 Spec amendments (§3 and §3.7) | 8 |
| §7 Reveal button removed, engine untouched | 2 |
| §8 Testing — all listed cases | 1, 4, 5 |

No gaps.

**Type consistency:** `drawCard(game, side, ctx)` is defined in Task 4 and used with three arguments at all three call sites in that same task. `spendCard(game, side, card)` is defined and called only in Task 4. `autoRepairIds(participants, results)` is defined in Task 5 taking an **array** and is called with an array in both places — `[...participants.values()]` in the engine (where `participantsOf` returns a Map) and `participants` directly in `BattleOverlay` (where it is already `Participant[]`). `FanSlot.left` means the wrapper's CSS left in both Task 1 and Task 2. `onLiftedChange` is the prop name in Task 2's `HandBar` and Task 2's `GameBoardPage` call site. `outcomeLabel` takes four arguments in Task 6 and is called with four in the same task.

**Placeholder scan:** No TBD/TODO. Every code step contains the actual code. The one deliberately non-literal step is Task 8 Step 5 (applying the seed and deploying), which routes through MCP tools rather than a shell command and points at `docs/claude/supabase.md` for the sequencing.
