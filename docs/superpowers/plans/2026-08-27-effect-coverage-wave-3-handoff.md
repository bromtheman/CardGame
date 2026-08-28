# Effect coverage — wave 3 handoff

Written at the close of wave 2 for whoever picks up wave 3. Wave 2 built the two
dispatch points wave 3 stands on (`ACTIVATE_VEHICLE` and `state.pendingEffect`),
so this is not background reading — Trebuchet, Eclipse, Braveheart and Orbit
Flank all re-enter machinery that did not exist a day ago.

Everything below was verified against the code at the wave-2 tip. Where a
document and the code disagree, the code is quoted and the document is named as
wrong.

**Binding authority:** `docs/superpowers/specs/2026-08-27-effect-coverage-design.md`.
§4.2 is `pendingEffect` **as shipped**, §4.3 lists the six dispatch points, §4.4
is battle summons, §7.4 is "spawning is not playing", §8's wave-3 table is your
card list. Read §4.2 before writing any effect that suspends.

---

## 1. Where things stand

Run this yourself before you touch anything; do not trust the numbers below if
they disagree with your own run.

```bash
npx vitest run                      # 412 passed / 29 files, 0 failed  ← NEVER pass --root
npx tsc -p tsconfig.json --noEmit   # exit 0
npm --prefix frontend run build     # exit 0
npm --prefix frontend run lint      # exit 0, with 7 pre-existing warnings across 5 files
```

- `--root` makes vitest match zero files. `passWithNoTests: false` guards it now,
  but the habit is the point.
- The 7 lint warnings (`react(set-state-in-effect)` ×5, `react(only-export-components)` ×2,
  in ConfirmDialog, auth, CardDetailsModal, CreateCardPage, HandBar) all predate
  this work. Lint still exits 0. Do not chase them and do not report a smaller
  number without counting.

**Worktree setup, if you take a fresh one.** `frontend/node_modules` can be
present but incomplete — wave 2's build failed on missing `@vitejs/plugin-react`
and `@tailwindcss/vite` until `npm --prefix frontend install` was run. And
`frontend/.env.local` does not travel into a worktree; copy it from the main
checkout if you need the dev server. It holds only `VITE_SUPABASE_URL` and the
publishable anon key (the only key CLAUDE.md permits in frontend env) and is
gitignored, so it cannot be committed.

### The coverage guard (`supabase/seed/effectCoverage.test.ts`)

| | Count | Contents |
|---|---:|---|
| `KNOWN_GAPS` | **22** | 9 wave 3, 8 wave 4, 5 wave 5 |
| `PARTIAL` | **2** | Plunderer, DWG Waters — both wave 4 |
| `EXEMPT` | 1 | Falcon Squadron, permanently |

Waves 1 and 2 are fully closed; a test asserts no `wave 1` or `wave 2` label
remains, and a second asserts `KNOWN_GAPS` has exactly 22 keys. **Both the map
entry and the `toHaveLength(22)` literal move in the same commit that registers
a name** — the stale-entry assertion fails the moment a listed card starts
working, so you cannot close a card and tidy the map later.

Two guard blind spots stay open and are not wave 3's to fix, but you should know
they are there: (1) a card that has left `KNOWN_GAPS` is no longer checked at
all — Garrison's trigger-key correction can be reverted today with the suite
green; (2) G3 catches only a *type*-level mis-wiring, never a same-type mix-up
between `playOnVehicleEffect` and `playOnCardEffect`. Wave 2 closed blind spot 3
by adding `PARTIAL`.

---

## 2. What wave 2 built that you are standing on

### 2.1 `state.pendingEffect` — one suspension slot (DP4)

```ts
interface PendingEffect {
  effect: string                    // registry name to re-enter
  side: Side                        // who owes the decision
  card: CardInstance                // the suspending card, verbatim
  kind: 'choice'                    // 'battle' is yours to add
  prompt: string
  options: { id: string; label: string }[]
  data?: Record<string, unknown>    // effect-owned continuation state
}
```

Files: `shared/engine/gameInit.ts` (the interface, the `PublicGameState` field,
the `buildInitialGame` default), `shared/engine/gameEngine.ts` (`normalizeState`
default, `PENDING_ACTIONS`, the freeze), `shared/engine/pendingEffect.ts` (the
`RESOLVE_PENDING_EFFECT` handler), `shared/effects/primitives.ts` (the `choice`
factory), `frontend/src/pages/game/PendingChoiceDialog.tsx` (the UI).

How it behaves:

- **The freeze is its own.** `applyAction` checks `state.pendingEffect !== null`
  **ahead of** the battle check and admits only `PENDING_ACTIONS` —
  `RESOLVE_PENDING_EFFECT`, `CONCEDE`, `ABANDON`. It is deliberately not folded
  into `battleFrozen`, whose `BATTLE_ACTIONS` admits `USE_HERO_POWER` and the
  three battle actions — including `DECIDE_BATTLE_REPORT`, which dispatches
  `onDeathEffect` today. So `activeBattle` and `pendingEffect` are **not**
  mutually exclusive because `BATTLE_ACTIONS` is blind to effect code; a
  reviewer traced the real reasons: (a) no hero power dispatches a registry
  effect, and (b) `DECIDE_BATTLE_REPORT` clears `activeBattle`/`pendingReport`
  **before** firing death triggers, so any death effect that suspends does so
  only after the battle freeze has already lifted. That is why `BattleOverlay`
  and `PendingChoiceDialog` still never render together today — but it rests on
  (a) and (b), not on construction, and a death effect that suspends via
  `choice` (yours to build) is exactly what will exercise it for the first
  time.
- **Resume is by name, into the same registration.** The card keeps one registry
  entry, so the guard still counts one implementation per card. Two optional
  fields on `EffectPayload` carry phase two: `resolution` and `pending`.
- **The slot is cleared *before* the effect is called**, so a continuation may
  suspend again. That is deliberate and it is for you — Trebuchet's "you may
  repeat this effect" is the reason.
- **Cancel and rollback escape.** `{ cancel: true }` clears the slot and logs a
  decline. If `effectFor(pending.effect)` returns `null` — a deploy rolled back
  under a live suspension — the handler clears the slot and logs, rather than
  bricking a game neither player can advance. Keep that property when you add
  `kind: 'battle'`.
- **The card is stored verbatim, not by name.** By resolve time an ability card
  has been `spendCard`'d into `state.destroyed`; a name could rebuild neither
  the payload nor the catalog probe's scan target. This is departure 1 of five
  recorded in §4.2 — read all five before you extend the slot.

**Worked example** (`shared/effects/dwgEffects.ts`) — the `effect: NAME` idiom,
the empty-options path and a `resolve` tail in one place:

```ts
const KRAKEN = 'krakenOnPlay'
registerEffect(KRAKEN, choice({
  effect: KRAKEN,                                    // ← the name to re-enter
  prompt: 'Refresh one of your used hero powers',
  options: ({ game, actor }) =>
    game.state.usedHeroPowers[actor].map((p) => ({ id: p, label: HERO_POWER_LABELS[p] ?? p })),
  resolve: ({ game, actor }, choiceId) => {
    if (choiceId === null) {                         // ← empty options: no suspension
      game.state.log.push('Kraken finds no used hero power to refresh')
    } else {
      game.state.usedHeroPowers[actor] = game.state.usedHeroPowers[actor].filter((p) => p !== choiceId)
      game.state.log.push(`Kraken refreshes ${HERO_POWER_LABELS[choiceId] ?? choiceId}`)
    }
    game.state.resources[actor].cp += 1               // ← the tail runs either way
    return true
  },
}))
```

Three rules that come out of that:

1. **`effect: NAME` is mandatory and a factory cannot infer it.** `choice`
   returns a plain closure and never sees the name `registerEffect` files it
   under. Bind the string to a const and use it twice. A wrong name compiles,
   passes every unit test that calls the effect directly, and fails only when a
   real player answers the dialog. Wave 2's reviewer had to check all three legs
   of the triangle by hand — `registerEffect` key, `choice({ effect })` value,
   seeded `meta` string — because nothing checks them at compile time.
2. **Empty options do not suspend.** `options()` returning `[]` calls
   `resolve(payload, null)` immediately so the tail still runs. Write `resolve`
   to handle `choiceId === null`.
3. **`options` is public.** It lives in `PublicGameState`. Only offer a choice
   over information the opponent already has. **A choice over your own hand or
   deck would leak it** and no private-options mechanism exists. Wave 3's
   Orbit Flank (a mode choice) and Air Strafe's Hydra/Cyclone pick (cards on the
   field) both qualify — check any new one.

### 2.2 `ACTIVATE_VEHICLE` — activated abilities (DP1)

`shared/engine/activate.ts`. Activating is not playing: the hull is already on
the board, so there is no placement legality, no material cost and no
`spendCard`. It charges `meta.activateCpCost` CP and stamps
`entry.activatedOnTurn = game.turnNumber` **before** the effect fires, so an
ability that suspends cannot be re-entered through a second activation. You get
that property for free in Braveheart and Eclipse.

`activatedOnTurn: number | null` is a **required** field on `ZoneCardEntry`
(defaulted in `normalizeState`, reset on both hulls by Boarding Party). The UI
gate is in `frontend/src/pages/game/BoardZone.tsx` — a "use" badge on the
`-bottom-1 -left-1` corner, which is the only free one (`-right-1 -top-1`
collides with the `fresh` "new" badge).

### 2.3 The three summon rows and `meta.summonOnly`

Flying Squirrel (DWG), Martyr (WF) and Parapet (OW) are seeded as real cards
with `meta.summonOnly: true`. They render on the board and in the card browser
but cannot be drafted. **Four enforcement sites exist today:**

| Where | File | Rule |
|---|---|---|
| deck validation | `shared/engine/deckValidation.ts` (~line 64) | rejects the card from a deck; mirrored into **both** `game-action` and `lobby-action` shared copies, plus `DeckBuilderPage`'s visible pool filter |
| catalog pools | `shared/effects/primitives.ts` (~line 107) | `drawFromPool`'s catalog branch skips them, so nothing mints a Martyr into a hand |
| Temporary cull | `shared/engine/gameEngine.ts` (~line 157) | `if (!isSummonOnly(entry))` before pushing to `state.destroyed` |
| battle death path | `shared/engine/battleResolve.ts` (~line 156) | same guard |

The last two matter because `reshuffleDiscard` feeds `state.destroyed` back into
the owner's deck — without the guard a destroyed Martyr becomes draftable.

**Your fifth site is the battle-summon sweep.** Spec §4.4 says summoned
combatants live only inside `ActiveBattle.summons`, never enter `zone.cards`,
and evaporate on approval **regardless of HP** — no repair eligibility, no death
record, nothing pushed to `state.destroyed`. That rule is stronger than
`isSummonOnly` and does not depend on it: a summon of a *draftable* card (Air
Strafe's PredatorX, Orbit Flank's Orbit) evaporates too. Write the sweep so it
never pushes, rather than reusing the `isSummonOnly` guard.

### 2.4 `spawnVehicles` — board spawns, and the ruling behind them

`spawnVehicles` / `spawnInto` in `shared/effects/primitives.ts` push a
catalog-minted hull into `zone.cards` with its printed keywords plus whatever
the summoning card grants (the merge de-duplicates). **Nothing else runs** — no
payment, no placement legality, and **no `onPlayEffect`**.

Spec §7.4 forces this: Sapphire prints "played into an empty zone → draw a card
and refund its cost", so firing on-play effects at spawn time would turn a 90k
Sapphire Screen into three bodies, three cards and a 90k refund. Board spawns
also bypass biome and screen rules, which is what lets a Martyr reach a land
zone.

Card text tells you which kind you are looking at, reliably: "fights alone
against…" / "alongside it in battle" is a **battle summon**; "spawn … into a
zone" is a **board spawn**. Orbit Flank contains both modes, which is the
evidence that the split lives in the data rather than being invented.

---

## 3. What wave 3 owns

Nine `KNOWN_GAPS` entries carry the `wave 3` label: the eight in spec §8's
wave-3 table — Flying Squirrel Attack, Martyr Attack, Air Strafe, Orbit Flank,
Gang Up, Braveheart, Eclipse, Trebuchet — plus **Excalibur**, re-filed out of
wave 1 rather than shipped half-wired. Its entry reads `wave 3 — a vehicle with
a hand target has no play path`, which is the same missing-firing-point problem
as Trebuchet's, in the other direction: Excalibur is a vehicle whose text
targets a card **in hand**, and no handler will carry it there.

New machinery: **DP3** `declareForcedBattle` (exported from `battleDeclare.ts`,
reusing `lockBattle`, skipping the Stealthy opt-out because the card *forces*
the fight, and setting the alert card), **DP6** `playOnVehicleEffect` on vehicle
cards, and **battle summons** (`ActiveBattle.summons`). None of it exists yet —
`grep` confirms no `summonBattle`, `declareForcedBattle` or `zoneRider` in
`shared/`.

Two rulings from §4.3 are already decided; do not re-litigate them:

- **A forced battle is not a zone activation.** It neither consumes nor is
  blocked by `lastActivatedTurn`. **Eclipse is the sole exception** and says so
  in its own text, so `eclipseEffect` stamps `lastActivatedTurn` itself.
- **Summons bypass placement legality.** A Martyr is not played, so biome and
  screen rules do not gate it — otherwise Martyr Attack fails against a target
  in a land zone.

### Housekeeping wave 2 left you, deliberately

- **`orbitFlankEffect ` still carries a trailing space** in
  `supabase/seed/source/builtInCards/LH-Built-in.js` (~line 373), and
  **`MartyrAttackEffect` is still mis-capitalised** in `WF-built-in.js`
  (~line 243). Spec §6 claims both were normalised "cosmetic, in the same pass".
  **That claim is false** — only `cauldronEffect` was. Both cards are yours, so
  the cleanup is yours. `effectName` trims, so the trailing space is currently
  harmless; note that `shared/effects/registry.test.ts` uses the literal
  `'orbitFlankEffect '` as a hand-built trim fixture, which is fine to leave.
- **Eclipse carries `onActivate: 'eclipseEffect'` with no `activateCpCost`** and
  no registered effect, so `BoardZone`'s eligibility gate — which requires
  *both* keys — never shows its button. Seeding the effect alone will not make
  it reachable from the board.
- **Braveheart ships with a completely empty `meta: {}`.** So does **Excalibur**.
  You must author their effect names and (for Braveheart) `activateCpCost`, not
  merely implement them. `[GT] Hunchback` and `[GT] Monsoon` were in exactly
  this state and cost wave 2 an unplanned seed edit.
- **`placement.ts` logs "<card> resolved" / "<card> deployed" unconditionally**,
  including when the effect suspended and the game is now frozen on a choice
  (four sites, ~lines 202/232/260/311). Pre-existing, uniform across every
  suspending on-play effect, out of wave 2's scope. Trebuchet will meet it.

---

## 4. Traps — read this section twice

Everything here bit wave 2 or is verified to be waiting for wave 3. Each is a
failure mode, not a principle.

### 4.1 The snapshot-destructure trap — TypeScript cannot catch it

Two places turn a `ZoneCardEntry` back into a bare snapshot by destructuring the
per-entry stamps **out by name**:

```ts
const { instanceId: _i, playedOnTurn: _p, movedOnTurn: _m, activatedOnTurn: _a, ...snapshot } = entry
```

- `endTurn`'s Temporary cull — `shared/engine/gameEngine.ts` (~line 155)
- the death path in `DECIDE_BATTLE_REPORT` — `shared/engine/battleResolve.ts` (~line 155)

Add a field to `ZoneCardEntry` and the compiler will make you fill in every
*literal* — and say nothing about these two. The rest spread swallows the new
key, it lands in `state.destroyed`, and `reshuffleDiscard` puts it back in the
deck as a hand card carrying a board-only field. Nothing fails; you find it by
reading the discard. **Edit both destructures in the same change, and put a
regression test at each site** — that is the only real net. Wave 2 added
`activatedOnTurn` to both correctly, but shipped with no regression test at
either; the review flagged it and a fix round added them, after the implementer
proved their teeth by reverting each production line and watching the new test
go red. Do the same.

`shared/effects/dwgEffects.ts`'s `loggerheadOnDeath` (~line 48) has the same
shape and is already one stamp behind. It is inert because it pushes to the
owner's *deck*, not to `destroyed` — but if you touch it, fix it.
`heroPowers.ts` (Change Order) and `placement.ts` (`spendCard`) also push to
`destroyed` but take hand cards, which never carry the stamps; they are not part
of this.

### 4.2 G3's `REACHABLE_TRIGGERS` needs its row *before* a card can leave `KNOWN_GAPS`

`REACHABLE_TRIGGERS` in `supabase/seed/effectCoverage.test.ts` (~line 91) maps
card `type` → the trigger keys the engine actually dispatches for it. G3 skips
any card still in `KNOWN_GAPS`, so the table only bites at the moment you close
one — and it reads as "this card is mis-wired", not "the table is out of date".

**This is loaded and pointed at you today.** Trebuchet is `type: 'vehicle'` and
carries `playOnVehicleEffect: 'trebuchetEffect'`, which is **not** in the
`vehicle` row. The instant you delete Trebuchet's `KNOWN_GAPS` entry, G3 fails.
Add `playOnVehicleEffect` to the `vehicle` row as part of building DP6, in the
same change. Wave 2 hit the identical wall with `onActivate` and Spectrum, and
ordered a whole task ahead of the card work to get the row in first — copy that
ordering.

### 4.3 The catalog probe is blind to a card that has been spent

`supabase/functions/game-action/index.ts` fetches the built-in catalog only when
a *candidate* card's `meta` names a `CATALOG_EFFECTS` effect. Three sources feed
the candidate list: the card at `action.instanceId` in the caller's own hand,
every on-field entry on both sides, and `state.pendingEffect.card`.

The third was wave 2's fix, and the reason is the trap: an ability is
`spendCard`'d into `state.destroyed` when it is played, so by the time
`RESOLVE_PENDING_EFFECT` arrives it is in neither hand nor field and the probe
cannot see it. Special Foundries and Robotic Assemblers would have resolved
against an empty catalog. **Any new dispatch point that fires an effect for a
card in neither hand nor field needs a fourth source** — check this for your
forced-battle and rider paths before you deploy.

### 4.4 `{ needsCatalog: true }` is invisible to unit tests

An effect that reads `ctx.catalog` — directly, via `catalogCard`, or through a
`drawFromPool` catalog pool — **must** be registered with
`registerEffect(name, fn, { needsCatalog: true })`. `CATALOG_EFFECTS` is derived
from that flag and is the only thing that makes `game-action` fetch the catalog.

**Unit tests cannot catch a missing flag, because they hand-build `ctx.catalog`
via `makeCtx`.** Green suite, dead card: every real play 400s in production.
Wave 2's plan omitted the flag on `allForTheCauseEffect` and the implementer
added it unprompted; the controller ruled the deviation correct and amended the
plan. Battle summons mint hulls by name from the catalog, so **nearly every
wave-3 registration will need this flag.** Check each one by hand.

### 4.5 A frontend test that transitively reaches `supabaseClient` throws at import

`frontend/src/lib/supabaseClient.ts` throws at module load when
`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are absent, and the root
`vitest.config.ts` has **no `envDir`**, so it never reads the gitignored
`frontend/.env.local`. Testing a pure helper in `games.ts` is enough to trigger
it, because `games.ts` imports the client for its query hooks. The error names
the missing env vars, so it reads as a config problem when the cause is the
import graph.

**Fix it with `vi.mock('./supabaseClient', () => ({ supabase: {} }))` in the
test file** (`frontend/src/lib/games.test.ts` is the worked example). Do *not*
add `envDir` to the root config — the suite would then depend on a gitignored
file and still fail on a fresh clone and in CI.

Corollary, and wave 2 learned it the hard way: **a suite that is green only
because your own shell exports those vars is not green.** Wave 2's implementer
reported 412 passing from a shell with the vars set while a clean shell had one
red file. Verify with the vars provably unset.

### 4.6 `npx tsc -p tsconfig.json --noEmit` does not typecheck edge functions

The root tsconfig's `include` is `["shared", "supabase/seed"]`.
`supabase/functions/**` is outside it entirely, and `**/*.test.ts` is excluded
too. A green tsc says nothing about a change to `game-action` or `lobby-action`,
and nothing about your test files. Careful reading is the only gate on
edge-function code in this repo.

### 4.7 Seed pool arrays are not the authority on pool membership

`GT_AIRSHIP` and `GT_HEAVY_AIRSHIP` in
`supabase/seed/source/builtInCards/OW-Built-in.js` are **source-file grouping,
not pool definitions**, and they lie: `[GT] Damacy` sits in `GT_AIRSHIP` but is
faction **OW**, and `[GT] Osprey` / `[GT] Achievement` are `vehicleType: 'plane'`,
not airship. The real pool is the `faction + vehicleType + materialCost` filter,
which yields **14 airships, 8 heavy (≥ `GT_HEAVY_AIRSHIP_MIN_COST` = 400,000),
6 light** — pinned by a guard test. Filter on card fields; never on array
membership.

### 4.8 Real effect names used as "unimplemented" stand-ins in tests

`shared/engine/placement.test.ts` uses **`eclipseEffect`** (lines ~164–172) as
its "vehicle with an unimplemented `onActivate` deploys fine with exactly one
vanilla note" fixture. **That test silently stops testing anything the moment
you register `eclipseEffect`** — it will still pass, having asserted nothing
about the unimplemented path. Rename it to a synthetic `t_`-prefixed name as
part of building Eclipse — see `shared/engine/activate.test.ts`,
`shared/engine/pendingEffect.test.ts`, `shared/effects/primitives.test.ts`, or
`shared/effects/registry.test.ts` for the pattern (`battleResolve.test.ts`
does **not** use it — it names its stand-ins `testAlwaysFailOnDeath` /
`neverImplementedOnDeath` — so it is not the exemplar to copy despite an
earlier version of this doc pointing there). `ambushEffect` and
`sabotageEffect` are the same trap in the same file
(lines ~151–256 and ~435–480) and belong to wave 5.

### 4.9 `lockBattle` does two things a forced battle must not do

Spec §4.3 tells you to build `declareForcedBattle` "reusing `lockBattle`". Read
`shared/engine/battleDeclare.ts` lines 6–17 before you do: `lockBattle` also

```ts
zoneById(game.state, zoneId)!.lastActivatedTurn = game.turnNumber
game.state.log.push(`Fleet battle declared in zone ${zoneId} — …`)
```

Both are wrong for a forced battle. The stamp contradicts §4.3's own ruling that
a forced battle is not a zone activation (**Eclipse excepted — it stamps
`lastActivatedTurn` itself**), and the log line says "Fleet battle" for what is
usually a 1v1. Reusing `lockBattle` unchanged would silently spend the zone's
one activation per turn, and the symptom shows up two actions later as "That
zone was already activated this turn" on a legitimate fleet attack. Split the
`activeBattle` construction out, or parameterise both behaviours.

### 4.10 `ActiveBattle.summons` is a *nested* new state field

`normalizeState` defaults top-level `PublicGameState` fields; §4.4 also requires
`summons` to default to `[]` on legacy rows, and it lives one level down inside
`state.activeBattle`. The existing pattern for that shape is the per-entry
`playedOnTurn` / `movedOnTurn` / `activatedOnTurn` loop at the bottom of
`normalizeState` — follow it. A live game mid-battle across your deploy is
exactly the row that will have `activeBattle` non-null and `summons` undefined,
and `participantsOf` (`shared/engine/battleResolve.ts:62`, which §4.4 has you
extend to merge the two sources) spreading `undefined` is a crash, not a fizzle.

### 4.11 Still true, and you were already warned — but they keep biting

- **Grep the seed source for a name before you register it.** Registering
  `paddlegunEffect` in wave 1 made Kraken silently fire Paddlegun's effect,
  because both rows named it. Wave 2 verified all nine of its names were unique
  before implementing.
- **Card text is authoritative** over any ported implementation that disagrees
  (spec decision 1).
- **`state.log` is public.** No line may name a card in a hidden hand or deck —
  and `pendingEffect.options` is public too.
- **Every commit touching `shared/` includes `npm run functions:sync` output.**
  A new file also needs a side-effect import in `shared/engine/index.ts` **and**
  a `supabase/functions/shared-manifest.json` entry under `game-action`. The
  drift test generates one case per manifest entry, so adding a shared file adds
  a test — expect a `+1` beyond your own.
- **Relative imports inside `shared/` carry the `.ts` extension.**
- Consumers import `shared/engine/index.ts`, never individual engine modules.

### 4.12 A vehicle-targeted activation has no UI path today

`GameBoardPage.tsx`'s `ZONE_TARGETED_ACTIVATIONS` set (~line 123) special-cases
exactly one activated ability — `monsoonActivate` — by reusing `moveMode`'s
`pickZone` phase to collect a `zoneId` before `onActivateClick` (~lines
125–135) sends `ACTIVATE_VEHICLE`. The `ACTIVATE_VEHICLE` action
(`shared/engine/engineTypes.ts`) also accepts an optional `targetInstanceId`,
but **nothing in the frontend ever sends one** — there is no picking mode for
"choose a vehicle" the way there already is for "choose a zone".

Braveheart ("1v1 vs an enemy vehicle in the same zone") needs exactly that:
after the corner "use" button fires, the player must pick an enemy vehicle in
Braveheart's own zone before `ACTIVATE_VEHICLE` goes out with both
`instanceId` and `targetInstanceId`. **The zone-pick mode is the pattern to
copy** — give Braveheart's activation its own phase in the `moveMode`-style
state machine (or a sibling piece of state), gated by a set/flag analogous to
`ZONE_TARGETED_ACTIVATIONS`. `BoardZone` already has two flavors of
"make specific on-field vehicles clickable" to extend rather than reinvent:
`fieldTargetingActive` / `onFieldTargetClick` (any vehicle, either side), and
`swapPickEnemyMode` / `onPickEnemyForSwap` (enemy vehicles, restricted to one
already-chosen zone — the closer shape to Braveheart's own-zone-only rule).

---

## 5. What wave 2 did NOT verify

Be clear-eyed about this. Two things did not happen, and neither is a formality.

1. **The in-game browser checks never ran.** Tasks 14 and 15 shipped the "use"
   button and `PendingChoiceDialog` without exercising either in a real game:
   doing so needs a signed-in account and a live two-player game, and the
   implementer could not enter credentials. They were verified by frontend build,
   lint, the `isMyMove` unit tests, a dev-server boot check for console/render
   errors, and static review of the wiring. **The engine paths underneath are all
   unit-tested; the UI wiring on top of them is not.** If the activate button or
   the choice dialog misbehaves for you, suspect the wiring first, not the engine.
2. **The live deploy and smoke test never ran.** They were pending the owner's
   approval at the time of writing. `game-action`'s catalog-probe change
   (§4.3 above) is verified *only* by that smoke test — it has no unit test and
   the tsc gate does not cover the file. **Confirm the deployed `game-action`
   actually carries the `pendingEffect.card` probe line before you assume
   Special Foundries or Robotic Assemblers work in production.**

Also unproven, at a smaller scale — deferred minors the wave-2 reviews recorded
rather than fixed. None is a present-day defect; each is a test that would not
catch its own regression:

| Where | What is not covered |
|---|---|
| `shared/engine/activate.ts` | the "effect name present but unregistered" 400 branch has no test anywhere; a refactor dropping the null check would crash unnoticed |
| `shared/effects/factionEffects.test.ts` | "Monsoon rejects an activation with no destination" asserts only `{ok:false,status:400}` — which is also what an *unregistered* name produces, so deleting `registerEffect('monsoonActivate')` leaves it green |
| `frontend/src/lib/games.test.ts` | case 1 does not discriminate the `pendingEffect` branch (`row()` hardcodes `active_player:'alice'`); cases 2 and 3 do catch a reversion |
| `shared/engine/gameEngine.test.ts` | "blocks a hero power" does not pin the freeze-check *order*; the two guards are independent and both 409, so order only changes which message wins |
| Sapphire Screen integration test | never inspects the spawned entries' keywords; de-duplication is covered instead at the primitive level in `primitives.test.ts` |

---

## 6. Before you start

1. Read spec §4.2 (all five departures), §4.3, §4.4, §7.1 and §7.4.
2. Read `docs/claude/architecture.md` (the destructure trap and the two freezes),
   `docs/claude/card-effects.md` (`choice`, `spawnVehicles`, `KNOWN_GAPS` vs
   `PARTIAL`), `docs/claude/testing.md` (the vitest traps) and
   `docs/claude/supabase.md` (the probe and the deploy runbook). All four were
   updated at the close of wave 2 with everything above.
3. Run the four commands in §1 and record your own baseline. If it is not
   412 / 29 green, find out why before writing a line.
4. Get `REACHABLE_TRIGGERS`' `playOnVehicleEffect` row in before any card work
   (§4.2 above).
