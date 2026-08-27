# Playtest Polish — Design Spec

**Date:** 2026-08-26
**Status:** Approved pending user review
**Origin:** First live playtest feedback (13 items)
**Amends:** `2026-08-24-ftd-card-game-design.md` §3 (deck-out) and §3.7 (Fragile)

The first real game surfaced 13 issues. Auditing them split the list cleanly in two:
problems with **how the game plays in the browser**, and the fact that **most cards
do nothing**. This spec covers the first. The second is Spec 2 (Effect Coverage) and
is explicitly out of scope here.

## 1. Decisions log

| Decision | Choice |
|---|---|
| Scope split | Two specs: playtest polish (this) and effect coverage (next) |
| Hand layout | Fanned arc, sized to always fit the container; never scrolls |
| Hand actions | Hover/focus/tap lifts one card; only the lifted card renders its buttons |
| Resource readout | Sticky header; own resources visually separated from opponent counts |
| Repair decisions | Two-step, same round-trip count: each side picks repairs for its own vehicles only |
| Scrappy repair | Auto-repaired by the engine, unconditionally; no toggle |
| Loggerhead | Drops `SCRAPPY` so the auto-repair rule needs no exception |
| Airship Fragile | Auto-assigned to **player-made** airships only; hand-marked on built-ins as a balance lever |
| Discard pile | Reuse `state.destroyed` — it already is one (Salvage draws from it) |
| Deck-out | Shuffle discard into deck and draw; no penalty rule |
| Reveal | Button hidden; `SET_ALERT_CARD` stays in the engine for Spec 2 to drive automatically |

## 2. Audit context

Run against `supabase/seed/source/builtInCards/` and the effect registry:

| Bucket | Count | Status |
|---|---|---|
| True vanilla (no card text, no meta) | 43 | Correct |
| Text satisfied by `additionalSpawns` alone | 4 | Correct — Pilferer, Corsair, Abactor, Pulverizer |
| Wired **and** implemented | 8 | Correct, except Marauder (see below) |
| Card text but **no effect name in meta** | 32 | **Silent no-op — no log line at all** |
| Names an effect that was never registered | 33 | Broken, but logs "not implemented yet" |
| **Total** | **120** | **65 broken** |

Two findings from that audit shape this spec:

- The 32 silent no-ops produce **no player-visible signal**. `noteUnimplemented` only
  logs when a meta key resolves to a name, so a card with `meta: {}` skips its text
  in total silence. Four of the seven cards reported in the playtest are in this bucket
  (Ransack, PredatorX, Victoria, Excalibur) — the player had no way to tell.
- `state.destroyed` is already a functioning discard pile: the Salvage hero power
  splices cards out of it (`heroPowers.ts:149`). "Add a discard pile" is therefore
  an extension, not a new subsystem.

Marauder is the one implemented-but-wrong card: `marauderOnPlay` is aliased to the same
`drawPlusCp` function as Crossbones (draw own deck, +1 CP), while its card text says
draw a vehicle from the **enemy** deck at −50k. `docs/claude/card-effects.md` records the
mismatch as a deliberate ruling; the playtest overrides it — card text is authoritative.
The fix belongs to Spec 2.

## 3. Fanned hand

### Problem

`HandBar.tsx` renders each card as `origin-top-left scale-75` inside an
`overflow-x-auto` flex row. `scale` is a transform: it shrinks the card visually but
the layout box stays 280px wide. In a `max-w-6xl` page with `p-6` padding (~1104px
usable) that is under four cards. The opening hand is five, so the hand scrolls from
turn one.

### Design

Replace the scrolling row with an absolutely-positioned arc inside a fixed-height,
`overflow-visible` container.

A new pure module `frontend/src/pages/game/handFanLayout.ts` computes per-card
geometry from hand size and container width — placed beside `zoneEffectBadges.ts`,
which follows the same "pure module + unit test next to the component" pattern:

```
step = min(MAX_STEP_RATIO × cardWidth, (containerWidth − cardWidth) / max(1, n − 1))
left(i)     = i × step
angle(i)    = (i − (n − 1) / 2) × DEG_PER_CARD
arcY(i)     = (i − (n − 1) / 2)² × ARC_K
```

**`cardWidth` is the card's *rendered* width at rest, not its 280px layout box** —
i.e. `CARD_W × REST_SCALE`. Confusing the two is what produces the current bug, so the
layout module takes rendered pixels and the component applies the scale.

`step` is the whole fix: the hand spans exactly the container regardless of `n`. Five
cards overlap gently; twelve compress to slivers; nothing ever scrolls. Rotation is
symmetric about centre with `transform-origin: bottom center` so the fan pivots from
the base of the cards.

Starting constants, all in the layout module rather than scattered through JSX — tune
by eye during the browser pass, but the plan implements these:

| Constant | Value | Note |
|---|---|---|
| `CARD_W` / `CARD_H` | 280 / 430 | Matches `PhysicalCard` |
| `REST_SCALE` | 0.75 | Preserves today's resting size |
| `MAX_STEP_RATIO` | 0.55 | Cap on spread, so a small hand stays a fan rather than a spaced-out row |
| `DEG_PER_CARD` | 4 | Total sweep of ~20° at five cards |
| `ARC_K` | 1.6 | Vertical drop in px at the fan's edges |

Worked example at the current `max-w-6xl` page (~1104px usable, `cardWidth` = 210):
five cards give `step` = 115 (ratio-capped), spanning 670px; twelve give `step` = 81,
spanning 1101px. Both fit without scrolling.

### Lift interaction

`HandBar` holds a `liftedId` in state, set by `onPointerEnter` and `onFocus`, cleared
by `onPointerLeave` and `onBlur`. The lifted card straightens to vertical (`rotate(0)`),
scales from `REST_SCALE` to `1` about `bottom center`, and raises `z-index`, over a
~150ms transition.

**The lift must never translate the card.** An earlier revision also moved it up by a
`LIFT_PX` constant, which slid the card's bottom edge out from under a cursor hovering
near it: the card left the pointer, `pointerleave` dropped it, it fell back under the
pointer, `pointerenter` lifted it again. Overlapping cards alternated in that loop.
Scaling about a pinned bottom edge is immune, because every point inside the resting
card is still inside the grown one — the rise comes entirely from the card getting
taller.

**Only the lifted card renders its action buttons** (`Play`, `Target`; see §7 for
`Reveal`). This resolves the overlap problem by construction rather than by z-index
fighting, and keeps the tab order to one card's worth of controls at a time.

Cards get `tabIndex={0}`, so keyboard focus lifts them. That is both the accessibility
path and the touch fallback — a tap fires `pointerenter`, lifting the card, and a
second tap reaches the button.

The existing per-card affordance styling is preserved: unaffordable cards keep their
dimming, the `selected` ring still marks placing/targeting state, and the
`effectiveCost !== materialCost` badge still renders.

*Files:* `HandBar.tsx`; new `handFanLayout.ts` + `handFanLayout.test.ts`.

## 4. Resource readout

### Problem

Two problems, and prominence is only the smaller one.

`GameBoardPage.tsx` renders your materials, your CP, opponent hand size, and opponent
deck size as four sibling spans in identical `text-sm text-ocean-300` — your own
spendable resources carry exactly the visual weight of opponent trivia.

More importantly the header **scrolls out of view**. Header, hero power bar, three
zones, and the hand exceed a laptop viewport, so at the moment you are looking at your
hand deciding what to play, the number you need is off-screen.

### Design

- Header becomes `sticky top-0` with a `z-index` below the lifted-card layer, so a
  lifted card passes over it rather than under.
- The four spans split into two groups: **yours** (materials + CP — large, brass,
  iconed) and **theirs** (hand + deck counts — small, muted, visually separated).
- Materials keep `shortHandNumber` display with the exact value on `title`.
- When a hand card is lifted, the materials figure tints red if that card is
  unaffordable — answering "can I play this?" at the moment the question is asked.

*Files:* `GameBoardPage.tsx`.

## 5. Repair ownership and Scrappy auto-repair

### Problem

`SUBMIT_BATTLE_REPORT` takes `repairs: string[]` covering **every** participant, so
whichever player fills in the report decides whether the opponent's damaged vehicles
get repaired — spending the opponent's materials. The opponent's only recourse is to
reject the whole report.

### Design — two steps, not three

The round-trip count stays exactly as it is today:

1. `SUBMIT_BATTLE_REPORT { results, repairs }` — `repairs` is validated to contain
   **only the submitter's own vehicles**; a foreign id is a `400`. All existing
   validation (band, Fragile, duplicates, full participant coverage) is unchanged.
2. `DECIDE_BATTLE_REPORT { approve: true, repairs?: string[] }` — a new optional field
   carrying the **approver's own** picks, validated identically. The effective repair
   set is the union of both sides' choices.

`pendingReport`'s stored shape (`{ submittedBy, results, repairs }`) does not change,
so a report already sitting in the database resolves normally; the new field is purely
additive on the action.

Per-side affordability is still computed at approve time and is still all-or-nothing —
but now each side is only ever charged for repairs it chose itself.

Rejection (`approve: false`) clears `pendingReport` and discards both sides' repair
selections, as today. A `repairs` array sent alongside `approve: false` is ignored, not
validated — rejection is unconditional.

### Scrappy auto-repair

Applied in the **engine**, not the UI. At resolve time any participant in the
80–89.999% band that is Scrappy and not Fragile survives, regardless of what either
`repairs` array contains. `repairCostOf` already returns 0 for Scrappy, so nothing is
charged.

`battleResolve.ts` exports `autoRepairIds(participants, results)` so `BattleOverlay`
previews precisely what the engine will do — one source of truth for both. Affected
rows lose the checkbox and show a static "Auto-repaired (free)" label.

A Scrappy id appearing in a submitted `repairs` array is accepted rather than rejected,
so clients need no special-casing. It is redundant, not additive: the vehicle is already
auto-repaired, the cost is 0 either way, and it must not be charged or counted twice.
(The existing "repair list contains duplicates" check is about repeats *within* one
array and is unchanged.)

### Loggerhead

Loggerhead is the only card that is both Scrappy and has a beneficial death trigger
(`loggerheadOnDeath` shuffles a free 0-cost copy into the deck), which would make
unconditional auto-repair silently deny its owner a real choice. Resolution: **drop
`SCRAPPY` from Loggerhead** in the seed data, making the auto-repair rule
unconditional.

Its repair cost becomes 17,500 — 70,000 base, halved by Half-Cost, halved again by
`REPAIR_COST_RATE`.

This requires `npm run seed:build` and applying the result to the remote database.
Games already in progress keep the old keyword set, because cards are snapshotted into
game state at start.

**Invariant for Spec 2:** a built-in card must not carry both `SCRAPPY` and an
`onDeathEffect`, or this collision returns.

*Files:* `battleResolve.ts`, `engineTypes.ts`, `BattleOverlay.tsx`,
`DWG-built-in.js` + reseed.

## 6. Deck-out reshuffle

### Problem

`drawCard` on an empty deck logs "no cards left to draw" and stops — per spec §3,
*"empty deck → no draw, no penalty."* The playtest ruling replaces that: the deck
recycles.

There was no discard pile to recycle. Played ability cards were dropped on the floor:
every ability handler calls `takeFromHand` and never stores the card anywhere.

### Design

`state.destroyed` becomes the discard pile. It is already public, already per-side,
already holds `SnapshotCard`, and Salvage already draws from it — so no new state key
and no migration for in-flight games.

- **Spent abilities enter it.** A `spendCard(game, side, card)` helper in
  `placement.ts` pushes a snapshot; every ability play handler calls it in place of
  dropping the card. Vehicles are untouched — they go to the field.
- **`drawCard` reshuffles on empty.** Its signature grows a `ctx` parameter for
  deterministic shuffling and fresh ids. Empty deck with a non-empty discard: move the
  **entire** pile into the deck (leaving `state.destroyed[side]` empty), shuffle via
  `ctx.rng()`, mint a fresh `instanceId` per card with `ctx.newId()` (as
  `loggerheadOnDeath` already does, since `SnapshotCard` carries no id), resync
  `state.counts[side]`, log the reshuffle and its count, then draw. Both empty: today's
  message, unchanged.

  The reshuffle triggers lazily, on a draw that would otherwise fail — never eagerly
  when the deck happens to reach zero.

`drawCard` has exactly three callers in `shared/` — `gameEngine.ts:129`,
`heroPowers.ts:146`, `dwgEffects.ts:10` — all inside functions that already hold `ctx`.

### Consequences

- **Reshuffling empties your Salvage pool.** Decking out carries a real cost without
  needing an explicit penalty rule.
- Spent abilities in the pile never appear as Salvage targets — that UI already filters
  to `type === 'vehicle'`.
- The public log gains a reshuffle line; it names no hidden-hand cards, so it satisfies
  the hidden-information rule.

### Spec amendments

Both applied to `2026-08-24-ftd-card-game-design.md` in the same commit:

- §3: *"empty deck → no draw, no penalty"* becomes *"empty deck → shuffle your discard
  into your deck and draw; if both are empty, no draw, no penalty."*
- §3.7: *"Fragile (auto-assigned to airships)"* becomes *"Fragile (auto-assigned to
  player-made airships; hand-assigned on built-ins as a balance lever)"*, matching
  `customCards.ts:19`, which only ever auto-assigned it on the custom-card path.

*Files:* `gameEngine.ts`, `placement.ts`, the design spec.

## 7. Reveal

No engine change. `SET_ALERT_CARD`, its handler, its validation, and the
`GameBoardPage` banner all stay.

The **button is removed from the hand**. Spec §3.9 defines the alert as the handshake
for cards whose effect needs opponent interaction — *"e.g. an ability that forces a
battle."* Every card that would use it (Flying Squirrel Attack, Martyr Attack, Air
Strafe, Ambush, Gang Up, Braveheart) is in the unimplemented 65, so the mechanic
shipped ahead of its cards and currently asks players to press a button whose purpose
does not exist yet.

Spec 2 reintroduces it as an **automatic** alert the engine sets when a forced-battle
card is played, which is the correct shape regardless — a mechanic that gates opponent
interaction should not depend on the player remembering to announce it.

*Files:* `HandBar.tsx`.

## 8. Testing

| Area | Tests |
|---|---|
| `handFanLayout` | Span never exceeds container width for n = 1, 2, 5, 12, 20; `left` monotonic; angles symmetric about centre; n = 1 centred with zero rotation |
| Repair ownership | Submitter repairing a foreign vehicle → 400; approver's repairs applied on approve; union of both sides; rejection discards both |
| Scrappy auto-repair | In-band Scrappy survives while absent from both arrays and is charged 0; Fragile never auto-repaired; a Scrappy id passed explicitly is deduplicated, not rejected |
| Affordability | Each side charged only for its own picks; over-budget side blocks approval as before |
| Reshuffle | Empty deck + non-empty discard reshuffles and draws; both empty logs and does not throw; reshuffled cards receive fresh `instanceId`s; deterministic under a seeded rng |
| Spent abilities | Every ability play path lands the card in `state.destroyed`; vehicles do not |
| Visual | Browser preview for §3 and §4 |

Commands: `npx vitest run`, `npm --prefix frontend run build`,
`npm --prefix frontend run lint`.

`shared/` changes in §5 and §6 require `npm run functions:sync` **in the same commit**
(the drift test enforces it) and a `game-action` deploy. §5 additionally requires
`npm run seed:build` plus applying the seed to remote.

## 9. Non-goals

- The 65 unimplemented card effects, including all seven named in the playtest — Spec 2.
- Correcting Marauder to match its card text — Spec 2.
- Any Fragile pass over the 16 built-in airships that lack it — deliberate per-card
  balance work, tracked separately.
- Any penalty attached to decking out.
- Discard-pile browsing UI, or any effect that returns cards from the discard.
