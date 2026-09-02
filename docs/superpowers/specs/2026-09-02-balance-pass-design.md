# 2026-09-02 balance pass — design

Source of truth for this pass: the balance note delivered as
`changes20260902.js` (11 new cards, 60 updated, 5 retired, across DWG/OW/SS/TG/WF).
Where that file and this document disagree, **this document wins** — every
departure is recorded in §3 with the reason.

The 2026-08-24 design spec stays binding for everything this pass does not
name. Read [docs/claude/card-effects.md](../../claude/card-effects.md) before
touching an effect and [docs/claude/supabase.md](../../claude/supabase.md)
before a deploy.

## 1. Shape of the work

Six branches. Wave 0 lands the shared foundation; the five faction waves each
land their own data **and** their own effects, so no wave ever ships a card
whose text the engine cannot honour.

```
Wave 0 (foundation)
   ├─→ DWG   6 cards,  2 effect edits
   ├─→ OW    6 cards,  1 new effect
   └─→ WF   14 cards,  7 effects + the deploy-order mechanic
          └─→ TG   23 cards, 8 effects (needs WF's deploy-order for Anguish)
                 └─→ SS   27 cards, 17 effects + 2 engine mechanics
```

76 card touches and **35 effects built, rewritten or edited** in total.

DWG, OW and WF are mutually independent and may run in parallel worktrees. TG
follows WF because `TG:Anguish` leaves `EXEMPT` using WF's mechanic. SS is last:
it is 36% of the pass and owns both remaining engine mechanics.

**Merges serialize.** `supabase/seed/seed_data.sql` is generated, so every
branch rewrites it and every rebase conflicts there. The resolution is always
the same and is never a hand-edit: take either side, run `npm run seed:build`,
commit. `supabase/seed/seedDataSync.test.ts` is what proves the result correct.

### 1.1 Why per-faction end-to-end keeps `KNOWN_GAPS` empty

The 2026-08-30 pass seeded data first and wired effects in later waves, which
is why `KNOWN_GAPS` grew to twelve entries and its `toHaveLength` literal moved
every wave. Landing each faction's data and effects together means **no wave
ever seeds an unwired card**, so `KNOWN_GAPS` stays empty for the whole pass and
its literal never moves. That removes the single worst merge conflict between
the five branches. If a wave finds itself wanting to add an entry, that is the
signal it has been split wrongly — not a licence to add one.

## 2. Wave 0 — foundation

Nothing in Wave 0 is faction-specific. It exists so the five faction waves do
not each build, or collide on, the same thing.

### 2.1 The `retired` meta key

Retirement is **hard**: a retired card is not a legal deck card.

`retired: true` is plain card data, not an effect name. It sits outside
`TRIGGERS` and outside `DATA_EFFECT_KEYS` — it satisfies no card text and
dispatches nothing — which puts it alongside `summonOnly` in the vocabulary.
Three exclusions, all of which must land together:

1. `validateDeck` (`shared/engine/deckValidation.ts`) rejects it, with its own
   error distinct from `summonOnly`'s: a retired card *was* legal once, and the
   message has to say so or 25 deck owners cannot tell what changed.
2. `DeckBuilderPage` drops it from the addable card list.
3. Every effect draw pool filters it — the `drawFromPool` pool in
   `primitives.ts` plus the **six** hand-rolled filters that already repeat the
   `summonOnly` exclusion by hand (`dwgEffects.ts` ×2, `lhEffects.ts` ×1,
   `ssEffects.ts` ×2, `wfEffects.ts` ×1). A retired card a Marauder can still
   mint is not retired. Wave 0 extracts these into one `poolEligible()`
   predicate rather than adding a second copy-pasted condition to each: six
   hand-maintained copies is exactly how `retired` came to be needed in the
   first place.

**The five cards stay in `supabase/seed/source/`**, carrying `retired: true`.
They are not deleted from it. This is a deliberate departure from the changes
file's "deleted" framing, and it is load-bearing: `gameInit.ts`'s `expandDeck`
**throws** `Missing snapshot for card <id>` on a dangling card id, so deleting
the rows would break 25 saved decks at game start rather than at deck edit.
Keeping the row upserted means all 28 active games finish normally and the deck
stays repairable by its owner.

**Wave 0 flips all five cards, not the faction waves.** Retirement is one
coherent change — the five rows, the three exclusions, the two orphan-causing
retirements and the deck affordance all describe a single state of the world,
and splitting them across five branches would ship the affordance in one deploy
and the breakage in another. The faction waves therefore do not touch their
retired card at all; they own only their new and updated cards.

⚠ A data key's VALUE is never checked by any guard — only its presence
(`docs/claude/card-effects.md`, blind spot 4). Wave 0 therefore adds a
seed-backed assertion that all five rows carry `retired === true`, and an
engine test that `validateDeck` rejects a deck holding one.

### 2.2 The affordance for the 25 affected decks

`supabase/functions/lobby-action/index.ts:153` validates both decks at lobby
creation. Without an affordance, 25 owners hit a validation error at the lobby
with no way to see why. So:

- DecksPage shows a "contains a retired card" badge on an affected deck.
- DeckBuilderPage names the specific retired card and offers to remove it.

Live counts at the time of writing (`decks.cards` is a jsonb object keyed by
card id, so membership is `cards ? id`): Halberd 8, Dryad 6, Acceptance 6,
Amusement 3, Harbringer 2 — 25 of 50 decks.

### 2.3 Guard de-collision

`supabase/seed/balancePass.test.ts` pins every number the 2026-08-30 pass
moved, in one file. Five branches editing it would conflict on every merge, so
this pass splits its own assertions per faction into
`supabase/seed/balance/<faction>.balance.test.ts`. The 2026-08-30 file stays
where it is and is not rewritten — its numbers are still true except where a
wave moves one, and a wave that moves one updates it in place.

⚠ **`DELIBERATE_ORPHANS` does need one edit, and it is not the map.** The map
itself grows by distinct lines and cannot conflict — but the assertion guarding
it, `it('the deliberate list is exactly the three the balance pass orphaned')`,
spells its expectation as a **single-line array literal**. OW adds
`bulwarkOnPlay` and SS adds `victoriaActivate` from parallel branches, and both
would rewrite that one line. The OW wave (which reaches it first) reformats the
literal to one name per line with each reason written down, so SS's later edit
is a clean insertion.

### 2.4 Amend card-effects rule 10

`docs/claude/card-effects.md` rule 10 currently states that a beneficial death
trigger on a `SCRAPPY` card "would be silently unreachable". **That is wrong**,
and it drove a past decision (Loggerhead's keyword removal).

`shared/engine/battleResolve.ts` `autoRepairIds` repairs a Scrappy hull only
when `REPAIR_WINDOW_MIN_PERCENT <= hp < SURVIVE_HP_PERCENT` (80–89.999%). Below
80% the hull is not repaired: it is removed from its zone, discarded, and
pushed to `destroyedEntries`, which is exactly what dispatches `onDeathEffect`.
A Scrappy card's death trigger is **reachable** — the free repair narrows the
band in which it fires, it does not close it.

Wave 0 rewrites the rule to say that, and records that it no longer forbids the
combination. Loggerhead is **not** reverted: restoring its keyword is a balance
decision this note does not make.

## 3. Rulings

Decisions taken during design, each binding on the wave that implements it.

**R-1 — Tiger Shark denies slots while alive, and does not stack.** The
changes file prints "whenever this vehicle is played into a zone", which reads
as a permanent stacking stamp. Rejected in favour of a while-alive,
non-stacking reading, and **the card text is rewritten to match**:

> While this vehicle is alive, your opponent has 3 fewer vehicle slots in this
> zone. This does not stack.

This makes the cap derived from board state rather than stored, which is why
§4.1 is as cheap as it is.

**R-2 — Tyr counts full rounds.** `turnNumber` advances in 0.5 steps, one per
half-turn. "Every turn it spends in your hand" means one 60k step per **1.0**,
matching `PURIFIER_LOSS_WINDOW_TURNS`, which already treats 1.0 as one round.

**R-3 — Sacrilego is 10,000, as written.** Not a dropped zero. A near-free
Stealthy Mobile ship that grants the friendly fleet SCRAPPY for each battle it
joins and compounds a 30k SS discount on each survival is the intended
build-around. Pinned in the SS balance test so it cannot drift silently.

**R-4 — Argonaut keeps SCRAPPY and gains its death trigger.** Permitted by the
corrected rule 10 (§2.4). The auto-repair band is acceptable: the trigger still
fires whenever the hull actually dies.

**R-5 — "AI vehicle" means `isBuiltIn`, not a faction.** This is what the
existing code compares (`repairmenReadyEffect` tests `entry.isBuiltIn`).
Repairmen Ready and Excalibur move AI→SS, narrowing their filters from
"built-in" to "faction === SS". **Excruciator's new text still says "AI", and
keeps the built-in meaning** — it is not a WF filter.

**R-6 — Brandistock gets its own registry id.** Its text is Halberd's, but the
implementation is registered as `brandistockOnDeath`. Reusing `halberdOnDeath`
is the Kraken/Paddlegun collision: the name is frozen into dealt game state,
the implementation behind it is redeployed for every game at once.

**R-7 — Sub Strike removes without a death trigger.** "Remove it from play" is
not "destroy it". The target leaves the board and is discarded, but
`onDeathEffect` does **not** dispatch. Recorded here because the two phrasings
are one line apart in the engine and the difference is invisible in review.

**R-8 — Dead rules are kept, and only two constants are actually dead.** Two
engine rules lose their last *card* (§5) and stay, commented, for the reason
`purifierEffect` is kept registered.

⚠ This ruling originally deleted four constants. **Two of the four are not
dead**, because keeping a rule keeps its constant:

| Constant | Reader | Verdict |
|---|---|---|
| `MARAUDER_DISCOUNT` | `dwgEffects.ts` only, and the rewrite removes it | **delete** (DWG) |
| `SACRILEGO_HP_BOOST` | `ssEffects.ts:361`, inside the clause Sacrilego's rework deletes | **delete** (SS) |
| `PURIFIER_LOSS_WINDOW_TURNS` | `placement.ts:95` (`battleLossMissing`) — a rule this ruling KEEPS | **keep** |
| `HARBRINGER_GUEST_MAX_COST` | `wfEffects.ts:220` (`harbringerPool`), reachable from `harbringerBattle`, which the retired-but-seeded Harbringer still names | **keep** |

Deleting either of the bottom two fails `tsc`. They stay exactly where they are
in `shared/gameSettings.ts` — they are still tunable game rules with live
readers, which is precisely what that file is for. Do not relocate them either:
moving a constant beside its reader is churn that buys nothing and widens the
merge surface.

## 4. New engine mechanics

### 4.1 Zone slot denial (SS wave)

Under R-1 the cap is **derived, not stored** — no new persistent state.

- Data key `slotDenial: 3` on the card, so the next card wanting the mechanic
  needs no engine edit. This is the reasoning `drawOnExpiry` and
  `blocksFaction` already record: a rule, not an effect-name check.
- New `zoneCapFor(state, side, zoneId)` returns
  `MAX_VEHICLES_PER_ZONE_SIDE − max(slotDenial of live enemy hulls in that zone)`.
  **`max`, not `sum`** — that is what "does not stack" means, and it makes a
  second Tiger Shark inert rather than lethal.
- Eight read sites move onto it: `placement.ts` (`legalZonesFor`, and the
  `room` calculation for `additionalSpawns`), `heroPowers.ts` (`moveEntry`),
  and frontend `BoardZone.tsx`, `GameBoardPage.tsx`, `laneLayout.ts`. The lane
  grid must render the reduced slot count, or the board lies about capacity.
- An opponent already over the reduced cap keeps every hull and simply cannot
  add more. Both engine call sites compare with `>=`, so this falls out with no
  extra code — but it needs a test, because it is the case a reader assumes was
  handled by culling.

### 4.2 Hand-residence stamp (SS wave, Tyr)

- `handEnteredTurn?: number` on `CardInstance`.
- `tyrCostModifier` returns `−TYR_HAND_DISCOUNT × floor(turnNumber − handEnteredTurn)`
  with `TYR_HAND_DISCOUNT = 60_000`. The floor at zero is already applied by
  `effectiveCostInGame`'s existing `Math.max(0, …)`; do not re-clamp.
- **The risk is a hand-entry path that forgets to stamp** — it yields a Tyr that
  is silently never discounted, with every test green. So the stamp goes in one
  `putInHand(game, side, card)` helper and the direct `hand.push` sites convert
  to it. This is the shape `drawCard` already uses to keep `state.counts[side]`
  in sync, and it inherits that resync for free.
- A test asserts every hand-entry path stamps: initial deal (`gameInit`),
  `drawCard`, and each effect that pushes directly (`reservesEffect`,
  `loggerheadOnDeath`, `balmungOnPlay`, and this pass's `slasherOnPlay` and
  `buzzsawOnPlay`).

### 4.3 Battle deploy order (WF wave)

- Data key `deployOrder: 'first' | 'last'`, meaning *this card's side spawns
  first / last*.
- Surfaced as an instruction line in the battle-prep UI. This is player conduct
  for staging the fight in From The Depths — the engine has no deployment-order
  concept and this pass does not give it one.
- Covers `WF:Veles` (`last`), `WF:Purifier` (`last` — "the enemy forces must
  spawn in first" is the same statement seen from the other side), and frees
  **`TG:Anguish` from `EXEMPT`** (`first`) after three waves parked there.

⚠ **Only one surface exists, not two.** This section originally said "the
battle-prep UI and the spawn sheet". `shared/customBattle.ts` cannot carry a
deploy order: `CustomBattleFile` has `SpawnDistanceBetweenTeams`, per-vehicle
`SpawnAltitude` and a spawn angle, and nothing ordering-shaped — FtD spawns both
teams at once. The only honest home is the battle panel in
`frontend/src/pages/game/BattleOverlay.tsx`. Leave `customBattle.ts` alone.

⚠ **`deployOrder` must go in `DATA_EFFECT_KEYS`.** `TG:Anguish` carries
`meta: {}` and one sentence of card text, and Veles ends up the same shape. The
moment Anguish leaves `EXEMPT`, G2 flags both as silent and `noteUnimplemented`
logs a false "plays as vanilla" line **to players**. The three existing members
whose whole card text IS the rule — `defensiveOmission`, `aircraftLock`,
`noBaseDamage` — are the precedent.

⚠ **Cancellation is on disagreement, not on presence.** The original rule — "if
both sides carry a directive they cancel" — is wrong, because two directives can
agree. Anguish on side A says *A spawns first*; Veles on side B also says *A
spawns first*. Normalise every carrier to the single question **"which side
spawns first?"** — the reading Purifier already forces — and cancel only when
the answers genuinely conflict. Pin the agreement case as well as the conflict
one.

There is also no React test infrastructure in this repo (`vitest.config.ts`
collects `*.test.ts`, and there are zero `.test.tsx` files), so the rule belongs
in `shared/engine/` as a pure, exhaustively unit-tested function, with the
rendering verified by build, lint and the browser.

## 5. Orphans, dead rules and dead constants

**Only two effects are actually orphaned, not five.** Retirement keeps the row
in the seed (§2.1), so a retired card still names its implementation in
`loadSeedData()` — and G4 asks exactly that question: *does any seeded card name
this implementation?* `halberdOnDeath`, `dryadBattle` and `harbringerBattle`
therefore keep a naming card, G4 stays green, and **they need no
`DELIBERATE_ORPHANS` entry**. Adding one would trip that map's own stale-entry
assertion. That is the correct outcome as well as the convenient one: those
cards are still reachable from 28 in-flight games and 25 unedited decks.

The two genuine orphans are caused by a **text rewrite**, where the card
survives but drops the meta key:

| Name | Orphaned by | Wave |
|---|---|---|
| `bulwarkOnPlay` | OW Bulwark's text and meta cleared | OW |
| `victoriaActivate` | SS Victoria reworked to an on-play effect | SS |

Both **stay registered** with a `DELIBERATE_ORPHANS` justification — a game
dealt before this pass carries a frozen snapshot still naming them — and
neither may ever be reused (R-6).

Two engine rules lose their last carrying card and are **kept, commented**
(R-8): `defensiveOmission`'s `unlessShipOrTank` arm (Buzzsaw and Veles both
drop the key) and `deployRequiresBattleLoss` with its per-zone battle-loss
tracking (Purifier drops it).

Four constants lose their last reader and are **deleted** (R-8):
`MARAUDER_DISCOUNT` (DWG), `SACRILEGO_HP_BOOST` (SS),
`PURIFIER_LOSS_WINDOW_TURNS` and `HARBRINGER_GUEST_MAX_COST` (both WF).

⚠ `HARBRINGER_GUEST_MAX_COST` has a second reader beyond `harbringerBattle`:
`balancePass.test.ts` asserts the pool it defines ("Harbringer draws from
exactly the WF ships at or under 100k"), and that assertion also breaks when
Buzzsaw and Earth Raker move. WF's wave owns both. See §7.2.

## 6. Per-faction inventory

Costs are `materialCost / blueprintCost`. "data" means no effect work — a seed
edit and a pinned assertion. Every new card carries a camelCase `imageUrl` by
convention; built-in image URLs are bare filenames with no hosted art
(`frontend/src/lib/cards.ts:23`), so no asset is required.

### 6.1 DWG — 6 updated

| Card | Change | Work |
|---|---|---|
| Marauder | 40k→55k; text drops "reduce its cost by 50k" | edit `marauderOnPlay` to stop discounting; delete `MARAUDER_DISCOUNT` |
| Plunderer | text adds "but increase its cost by 20k" | edit `plundererRaid` to stamp `+20_000` costDelta on the drawn card; new `PLUNDERER_CAPTURE_SURCHARGE` |
| Tarpon | `+SUB_SCREEN` | data |
| Loggerhead | `−HALF_COST` | data |
| Buccaneer | 200k→225k, `+FRAGILE` | data |
| Spawn Buccaneer | 150k→225k | data |

⚠ **The FRAGILE+SCRAPPY worry this section originally raised does not arise.**
`spawnBuccaneerEffect` builds its entry with `keywords: [KEYWORDS.SCRAPPY]` —
it **replaces** the printed array rather than merging it, unlike `mintHull`. So
a played Buccaneer is `['fragile']` and a spawned one is `['scrappy']`, and the
two keywords never meet on one hull. That is existing, deliberate behaviour
(its test already feeds it a catalog card carrying an unrelated keyword and
asserts `[KEYWORDS.SCRAPPY]` alone), and **this pass does not change it** — the
DWG wave pins the real behaviour instead.

Worth knowing if it is ever revisited: merging would make the granted `SCRAPPY`
inert, because `autoRepairIds` checks `FRAGILE` first and returns before the
`SCRAPPY` test.

### 6.2 OW — 1 new, 4 updated, 1 retired

| Card | Change | Work |
|---|---|---|
| **Brandistock** (new) | ship 250k/258k, `SUB_SCREEN`, "When this card is destroyed, draw a random GT Airship" | new `brandistockOnDeath`, `{ needsCatalog: true }` (R-6) |
| Bulwark | 400k→450k, bp 466k→848k, text cleared | **remove `onPlayEffect`**; orphan `bulwarkOnPlay` |
| The Onyx Throne | text wording only | data |
| Eyrie | 780k→575k, bp 781362→809000, `halfCost+blocker` → `blocker+fragile` | data — see the note below on what this actually costs |
| Rook | `vehicleType: 'airship'` now stated in source | data; **remove the now-inert `OW:Rook` entry from `VEHICLE_TYPE_PATCHES`** in `transform.ts` and move its reasoning comment onto the card |
| Halberd | retired | **Wave 0** (§2.1) — OW's wave does not touch it |

⚠ **Eyrie's printed cost falls but its real cost rises.** `halfCost` is applied
at usage time by `effectiveMaterialCostOf`, never baked into the stored number,
so Eyrie costs 390k today (780k halved) and 575k afterwards. That is a 47%
**nerf**, not the 26% cut the printed figures suggest. Pin it with that note, or
a later reader scores it backwards.

### 6.3 WF — 1 new, 12 updated, 1 retired

| Card | Change | Work |
|---|---|---|
| **Sub Strike** (new) | ability 100k, cp 1, "Target an enemy submarine, remove it from play" | new `subStrikeEffect`; removal without a death trigger (R-7) |
| Buzzsaw | 80k→75k, `+STEALTHY+SCRAPPY`, repurposed to "put an ambush card into your hand" | drop `defensiveOmission`; new `buzzsawOnPlay`, `{ needsCatalog: true }` |
| Veles | 280k→225k, `+STEALTHY+SCRAPPY`, "spawned into battle after all enemies" | drop `defensiveOmission`; `deployOrder: 'last'` (§4.3) |
| Excruciator | 660k→600k, `+SUB_SCREEN`, "draw two AI vehicles from your deck and reduce their cost by 100k" | rewrite `excruciatorOnPlay`; built-in filter (R-5) |
| Scourge | 240k→225k, bp 249k→209k, "gain 1cp" | new `scourgeOnPlay` |
| Pandemonium | 350k→225k, bp 354k→244k, `+SUB_SCREEN` | data |
| Disemboweler | "gain 1 cp" | new `disembowelerOnPlay` |
| Pulverizer | 120k→78k | data |
| Slasher | 350k→300k, "add two earth rakers to your hand, they cost 0" | new `slasherOnPlay`, `{ needsCatalog: true }` |
| Earth Raker | "When this is played, draw a card" | new `earthRakerOnPlay` |
| Purifier | 760k→750k; drops the deploy prerequisite, keeps `noBaseDamage`, gains "enemy spawns first" | drop `deployRequiresBattleLoss`; `deployOrder: 'last'` |
| Judgement | activation becomes free | `activateCpCost: 0` — data. `parsePrice` accepts 0 and `BoardZone` gates on `typeof === 'number'`, so the button survives; assert both |
| Harbringer | retired | **Wave 0** (§2.1). WF's wave still deletes `HARBRINGER_GUEST_MAX_COST`, whose last reader goes with it |

WF also flips `TG:Anguish` to `deployOrder: 'first'` and removes it from
`EXEMPT`, because WF owns the mechanic. That is the one edit WF makes to
`TG-built-in.js`; TG's wave must expect it.

### 6.4 TG — 5 new, 16 updated, 2 retired

New: **Mania** (ship 270k/574k, `ROBOTIC+UPKEEP_REQUIRED`, vanilla);
**Spawn Audacious** (ability 40k, mirrors `spawnBuccaneerEffect` with its own
id, `{ needsCatalog: true }`); **Agony** (sub 375k/440k, `BLOCKER`, grant an
enemy vehicle `FRAGILE`); **Wonder** (ship 700k/865k, refresh **all** hero
powers and gain 1cp); **Repurpose** (ability, cp 1, destroy a friendly TG
vehicle and gain resources equal to its cost).

Effect work on existing cards: **Horror** (drop the `battle.survived` gate, add
an aggressor gate — "participates in an **offensive** fleet battle" now fires
whether or not it lives); **Duel** (add "if the opponent's vehicle dies, draw a
card"); **Spite** and **Loathing** (new on-play grants of `FRAGILE` and
`INOFFENSIVE` respectively — Spite shares Agony's shape, with its own id).

Data only: Jealousy 400k→375k, Obsession 330k→300k, Euphoria 580k→300k, Anguish
260k→200k, Curiosity 80k→40k, Vengeful 160k→150k, Havoc Factory 120k→25k, Mirth
Factory 200k→60k (+text casing), Fear 800k→500k, Nostalgia 90k→75k `−UPKEEP`,
Alarmed 230k→**0** `−UPKEEP`, Horror `−UPKEEP`, **Obelisk `sub`→`ship`**.

Retired: Amusement and Acceptance — both **Wave 0** (§2.1); TG's wave does not touch them.

⚠ **Obelisk's type change moves it out of `SUB_COPY_LIMIT` accounting.** A deck
at the 6-sub limit that holds Obelisk silently gains headroom. Harmless, but
assert the new type so it is not read as a typo later.

### 6.5 SS — 4 new, 22 updated, 1 retired

New: **Thresher Shark** (ship 580k/914k, `BLOCKER+SUB_SCREEN`,
`resourceSurge: { materialsUnder: 580_000, grantKeywords: ['halfCost','inoffensive'] }`
— the threshold is its own printed cost, which `materialsUnder` expresses
exactly); **Bull Shark** (ship 640k/898k, `BLOCKER+SUB_SCREEN`, 200k base damage
on surviving an offensive battle, via `BASE_DAMAGE_DIVISOR` like every other
base-damage figure); **Tiger Shark** (ship 690k/914k, `slotDenial: 3`, text
rewritten per R-1); **Cash advance** (ability, cp 2, gain 150k this turn then
draw).

Effect work: **Victoria** (drop the activated ability, new on-play pick of an SS
ship in hand for −75k; orphan `victoriaActivate`); **Trondheim** (400k→375k, bp
403k→393k, death trigger now draws an SS ship at −75k); **Air Strafe**
(180k→150k, target widens from ship to any vehicle); **Repairmen Ready** and
**Excalibur** (filters narrow built-in → SS, R-5); **Braveheart** (now targets
any friendly ship in the zone — a two-step choice); **Tyr** (new text,
`costModifier: 'tyrCostModifier'`, §4.2); **Nothung** (470k→400k, now reduces
all SS ships in hand by 40k); **Sacrilego** (80k→**10k** per R-3, grants
friendly ships `SCRAPPY` for each battle it joins and −30k to SS ships in hand
on each survival); **Resolute** (draws an SS ship at −40k); **Typhoon**
(`−BLOCKER`, `additionalSpawns: 1`); **Cyclone** (grants every enemy vehicle in
the zone `FRAGILE`); **Spectre** (210k→200k, reduce opponent CP by 1, min 0);
**Hydra** (230k→220k, refresh **one** hero power then gain 1cp — reuses Kraken's
refresh-choice machinery with its own id); **Argonaut** (death trigger reducing
a random SS ship in hand by 50k, keeping `SCRAPPY` per R-4); **Paladin** (drops
`resourceSurge`; gain 1cp on play, then 1cp to spawn another Paladin — the shape
Victoria's retired activate had, with its own id).

Data only: Iron Maiden 170k→150k, Asphodel 470k→400k `+STEALTHY`, Wolin
270k→250k, Mobula 600k→500k, Balmung 630k→620k, Chrysaor (100k→75k, surge
thresholds 200k→150k and costDelta 100k→75k).

Retired: Dryad — **Wave 0** (§2.1). SS's wave still deletes `SACRILEGO_HP_BOOST`, orphaned by Sacrilego's rework rather than by the retirement.

## 7. Testing and verification

⚠ **A new effect and the card that names it MUST land in the same commit.**
Both split orderings leave the suite red, so this is not a preference:

- **Effect first** → G4 (`effectCoverage.test.ts`, "names no orphan outside the
  deliberate list") fails, because a registered name no seeded card mentions is
  exactly what G4 hunts.
- **Seed first** → G1/G2 fail, because a card naming an unimplemented effect
  needs a `KNOWN_GAPS` entry, and §1.1 requires that map to stay empty.

Keep TDD ordering *inside* the task — failing test, implement, pass — and put
the registration, the seed row, `npm run seed:build` and the balance-guard row
in one commit. Run the **full** `npx vitest run` before it: a targeted run of
one test file will not show G4 going red, which is how this shape survives
review. Say why in a comment, so nobody later "tidies" it into two commits.

Per-branch, in order:

1. Failing engine test **first**, for every effect. No exceptions
   (`docs/claude/card-effects.md`, workflow rule 1).
2. Seed source edit → `npm run seed:build` **in the same commit**.
3. `supabase/seed/balance/<faction>.balance.test.ts` spells out every cost,
   keyword, vehicle type and threshold the wave moved — written as literals,
   never derived from the source being checked.
4. `npx vitest run`, reporting the **before→after passing count**. A wave that
   reports "tests pass" without both numbers is not verified.
5. `npm run functions:sync` in the same commit as any `shared/` change.
6. `npx tsc -p tsconfig.json --noEmit`, `npm --prefix frontend run build`,
   `npm --prefix frontend run lint`.

### 7.1 The `needsCatalog` check is not optional

Five effects in this pass read `ctx.catalog` and therefore need
`{ needsCatalog: true }`: `brandistockOnDeath` (mints a GT airship),
`spawnAudaciousEffect` and `paladinActivate` (mint a hull onto the board),
`buzzsawOnPlay` (mints an Ambush card into hand) and `slasherOnPlay` (mints two
Earth Rakers into hand).

The near misses are worth naming, because "it draws a card" is not the test:
Trondheim and Resolute draw from the owner's **deck**, not the catalog, and
Typhoon's second copy is `additionalSpawns`, which `placement.ts` resolves — none
of the three touches `ctx.catalog`. **A unit test cannot catch a missing
`{ needsCatalog: true }`** —
`makeCtx` hand-builds a catalog, so the suite stays green while `game-action`
runs the effect against an empty one and 400s on every real play. Each wave
verifies its effects appear in `CATALOG_EFFECTS` before it closes.

### 7.2 The existing assertions this pass invalidates

They are **expected failures, not regressions** — each is updated in place by
the wave that causes it (§2.3), and a wave that meets one unprepared will waste
time treating it as a bug.

⚠ **Three files carry them, not one.** This section originally named only
`balancePass.test.ts`:

| File | Scope | Waves |
|---|---|---|
| `supabase/seed/balancePass.test.ts` | 14 assertions, itemised below | DWG, WF, SS |
| `shared/engine/battleDeclare.test.ts` | 1 — "the two real seeded cards carry exactly the value the engine compares" asserts `['Buzzsaw','Veles']` carry `defensiveOmission`. WF drops the key from both, so the list empties. | WF |
| `supabase/seed/tgFaction.test.ts` | Extensive — a 343-line guard pinning all 26 TG cards' costs, keywords and types, the 26-fresh/30-total counts, the 8/8/4/3/3 vehicle-type split, and the ten-card upkeep table. TG's wave moves all of it. | TG |

`tgFaction.test.ts` is the one to plan for properly: TG adds five cards
(26→31 fresh, 30→35 total), moves Obelisk `sub`→`ship` (changing the split), and
takes `UPKEEP_REQUIRED` off Horror, Nostalgia and Alarmed while Mania brings it
— so the upkeep table goes from ten entries to eight, with recomputed values.
`balancePass.test.ts` contains **no TG assertions at all**.

The 14 in `balancePass.test.ts`:

Nine are rows in that file's `CARDS` map, which pins cost, blueprint cost,
keywords, vehicle type and card text per card:

| `CARDS` row | Broken by | Wave |
|---|---|---|
| `DWG:Tarpon` | keywords gain `subScreen` | DWG |
| `DWG:Buccaneer` | 200k→225k and keywords gain `fragile` | DWG |
| `WF:Pontus` | 150k→75k | WF |
| `WF:Purifier` | 760k→750k | WF |
| `SS:Chrysaor` | 100k→75k | SS |
| `SS:Nothung` | 470k→400k | SS |
| `SS:Balmung` | 630k→620k | SS |
| `SS:Asphodel` | 470k→400k and keywords gain `stealthy` | SS |
| `SS:Argonaut` | `cardText` moves from empty to its new death trigger | SS |

Five are standalone `it(...)` blocks:

| Assertion | Broken by | Wave | Action |
|---|---|---|---|
| "Judgement carries the 1cp price its text prints" | `activateCpCost` 1 → 0 | WF | update |
| "Harbringer draws from exactly the WF ships at or under 100k" | `HARBRINGER_GUEST_MAX_COST` is deleted with its last reader (§5) | WF | **delete** |
| "Paladin surges UNDER 240k, granting halfCost and temporary" | Paladin drops `resourceSurge` entirely | SS | update |
| "Victoria carries the 200k material price its text prints" | Victoria's activated ability becomes an on-play effect | SS | update |
| "Double Up and Repairmen Ready print the thresholds their code enforces" | Repairmen Ready's text moves "AI vehicle" → "SS vehicle" (R-5); the Double Up half is unaffected | SS | update |

Only the Harbringer one is deleted — its subject is retired and its constant
goes with it. The other thirteen are rewritten to the new values.

⚠ Four cards move but keep their `CARDS` row intact, because the row pins only
the five fields above and the change is elsewhere: `SS:Paladin` and
`SS:Victoria` (meta only), `WF:Judgement` (meta only) and `WF:Harbringer`
(retirement adds a meta key). **Do not delete those rows** — they still assert
true things.

### 7.3 Close-out

Each wave names what it did **not** finish rather than declaring itself
complete, and confirms `KNOWN_GAPS` is still empty (§1.1). After the final
merge, verify `game-action`'s deployed version incremented — **by content, not
file count**: a deploy legitimately reads back with fewer modules because
type-only imports are erased in transpilation.

## 8. Out of scope

- Loggerhead's `SCRAPPY` is not restored, despite §2.4 removing the rule that
  took it. That is a balance decision this note does not make.
- No change to `MAX_VEHICLES_PER_ZONE_SIDE` itself; §4.1 only makes the value
  the engine reads a function of board state.
- The engine gains no deployment-order concept; §4.3 is conduct text.
- No repair of the 25 affected decks on the owners' behalf. §2.2 gives them the
  information to repair their own.
