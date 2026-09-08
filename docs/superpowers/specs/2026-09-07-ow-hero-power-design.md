# 2026-09-07 OW hero power — Hold the Line — design

Replaces the Onyx Watch faction hero power **Change Order** with **Hold the
Line**. One power in, one power out; no card data changes.

The 2026-08-24 design spec stays binding for everything this document does not
name, and §3.8 of that spec is amended by §2 below. Read
[docs/claude/architecture.md](../../claude/architecture.md) before touching the
engine and [docs/claude/supabase.md](../../claude/supabase.md) before a deploy.

## 1. Why Change Order goes

> *Discard an OW vehicle card. Draw a copy of a player made ship or tank from
> your deck in two turns.*

It is not merely weak — it is **strictly negative**, and has been since it
shipped. The redelivery in `endTurn` filters the drawing player's deck on
`isBuiltIn === false` (`shared/engine/gameEngine.ts:442`):

```js
const pool = priv.deck.filter(
  (c) => c.isBuiltIn === false && (c.vehicleType === SHIP || c.vehicleType === TANK),
)
```

The live `cards` table holds **170 rows, all `is_built_in = true`**. There is no
custom-ship pipeline in flight, so the pool is empty by construction and the
scheduled item always takes the fizzle branch. Pressing the OW hero power today
costs 1 CP, sends an OW vehicle to the graveyard, and two turns later logs
*"Change Order finds no player-made ship or tank."*

It is the only hero power in the game with negative expected value.

## 2. The replacement

> **Hold the Line** — OW, 1 CP, once per game.
> *Choose a zone. Until the start of your next turn, your vehicles are
> considered to have Scrappy in any fleet battle fought in that zone.*

Scrappy zeroes a hull's repair bill (`repairCostOf`, `REPAIR_COST_RATE = 0.5`),
so a hull that ends a battle in the 80–89.999% window is repaired free instead
of costing half its effective material cost — or being lost because its owner
could not pay.

### 2.1 Why this power for this faction

The Onyx Watch are Neter's old money: a mercantile navy of oil barons who broke
from the Steel Empire to fund their own protection, and whose doctrine the wiki
gives as *combat from behind strong walls at great distance* — castle ships of
spaced metal armour, slow, surviving on sheer bulk.

Hold the Line is that sentence as a rule: **bulk plus money means nothing the
Watch owns stays broken.** It rewards the deck OW actually has — Bulwark, Eyrie
and The Onyx Throne wall a zone, the Parapets thicken it, and the draw engine
refills the hand — without handing that deck anything it can attack with.

### 2.2 Why it is the mirror of Flanking Maneuver

The power level is anchored to a power already in production rather than to
judgement. WF's Flanking Maneuver and Hold the Line are the same mechanism
pointed in opposite directions:

| | WF Flanking Maneuver | OW Hold the Line |
|---|---|---|
| Arms | a zone, on your turn | a zone, on your turn |
| Applies to | the **enemy** fleet | **your own** fleet |
| Grants | Fragile — no repairs | Scrappy — free repairs |
| Battle scope | one battle **you start** | any battle in the window |
| Window | rest of your turn | until the start of your next turn |
| Outcome | enemy hulls die | your hulls keep their materials |

Hold the Line is deliberately the **weaker half**. Flanking Maneuver removes
enemy cards from the board permanently; Hold the Line only refunds repair bills
inside a ten-percentage-point HP band. It never saves a hull below 80%, and
Fragile overrides Scrappy (R-1), so it does nothing at all for Eyrie — OW's most
expensive card, which prints Fragile.

## 3. Power-level calibration

Every hero power in the game, with the mechanics traced through:

| Power | Lasts | Card economy | Material swing |
|---|---|---|---|
| Hero Power Draw | — | +1 | 0 |
| Salvage | — | +1 (chosen from graveyard) | 0 — the card is still paid for on replay |
| Rapid Redeployment | permanent | 0 | 0 |
| Tactical Positioning | one battle | 0 | 0 |
| DWG Boarding Party | permanent | 0 (1-for-1) | ~0 — gated to ≤ your own hull's effective cost |
| LH Flyby | **one turn** | **−1** | saves ≤400k, hull evaporates at END_TURN |
| SS Counter Intelligence | permanent | 0 | 0 — denial only |
| TG Drones | **one turn** | 0 | 3 bodies at 100k effective each |
| WF Flanking Maneuver | one battle | 0 | converts enemy hulls into kills |
| **OW Hold the Line** | **one round** | **0** | **contingent repair refund** |

Two properties of the existing set constrain the design:

1. **No power grants permanent material advantage.** The two that touch
   materials at all (Flyby, Drones) both hand over *disposable* hulls. A Mirth
   Swarm and a Flyby'd hull are both stamped `playedOnTurn = turnNumber`, and
   `baseStrikersIn` requires `playedOnTurn < turnNumber`, so **neither can ever
   bombard a base**; both carry Temporary and are culled at END_TURN
   (`shared/engine/gameEngine.ts:385`).
2. **No power grants card advantage beyond the universal +1.**

Hold the Line grants neither. Its payout is contingent on a hull landing in the
80–89.999% band, which the player does not control, and it expires on a clock.

### 3.1 A discount power was considered and rejected

An earlier candidate — *"reduce an OW vehicle in hand by 300,000"*, using the
existing `meta.costDelta` mechanism — was dropped on two grounds:

- It would be the **largest material swing in the game**, permanent, on the one
  axis every other power deliberately avoids (property 1 above).
- Its justification did not survive the data. OW is **not** a cost-starved
  faction: average vehicle cost 291k (4th of 7) and a **575k ceiling, the
  cheapest maximum of any faction** (GT 770k, LH 800k, SS 950k, TG 730k, WF
  750k). OW's identity is walls and card draw, not expensive hulls.

## 4. Mechanics

Hold the Line is a `state.zoneEffects` rider, read at battle lock into a
battle-scoped flag — the same two-part shape Flanking Maneuver already uses.

**Arming.** `holdTheLine(game, actor, zoneId)` in `shared/engine/heroPowers.ts`
pushes:

```ts
{
  effect: HOLD_THE_LINE_EFFECT, zoneId, side: actor, cardName: HOLD_THE_LINE_NAME,
  setOnTurn: game.turnNumber, expiresOnTurn: game.turnNumber + 0.5,
  data: { holdingTheLine: true },
}
```

`data.holdingTheLine` is a plain data rule, read directly by the engine the way
`blocksFaction` and `flanking` are — **not** a registry effect. A hero power has
no card, and `fireRider` mints its payload card from the catalog by `cardName`,
which would need a fake card. The name is still unique so the zone badge can key
off it.

**Consumption.** `applyHoldTheLine(game)` in `shared/engine/battleDeclare.ts`,
called from the same place as `applyFlankingManeuver` — **after**
`dispatchBattleLock`, so a lock trigger's `joinBattle` cannot add a hull the
grant then misses. It finds a rider on the battle's zone owned by either
participating side and sets `battle.scrappySide = <that side>`. It does **not**
splice the rider out (R-4).

**Reading.** A new `scrappyInBattle(battle, entry, side)` in
`shared/engine/battleResolve.ts`, mirroring the existing `fragileInBattle`, and
`repairCostOf` gains the battle and side.

**Expiry.** A new sweep in `endTurn`'s **incoming-side** block (§5, R-3).

## 5. Rulings

- **R-1 — Fragile beats Scrappy.** Spec §3.7: Fragile "Overrides Scrappy". A
  hull that is Fragile — by printed keyword, or by an enemy Flanking Maneuver's
  `fragileSide` — is destroyed in the repair band regardless of Hold the Line.
  `fragileInBattle` is therefore tested **first**, and `scrappyInBattle` never
  reached for such a hull. This excludes OW's own Eyrie, and is the power's main
  natural brake.
- **R-2 — Attack or defend.** The grant applies whether the owner declared the
  battle or is defending it. This is the deliberate inverse of Flanking
  Maneuver's "the next battle **you start**": a defensive power that skipped
  defensive battles would be worthless, and OW is attacked on the opponent's
  turn.
- **R-3 — The window, and why the expiry moves.** `turnEndRiders` cannot own
  this one. It skips any rider whose `rider.side !== endingSide`, so a rider
  owned by A is only ever swept at A's *own* END_TURN — which means it would
  survive intact through the whole of A's next turn, one turn too long. The
  sweep therefore goes in the **incoming-side** block of `endTurn` (beside the
  `changeOrderDraw` redelivery, which runs for the side whose turn is starting),
  removing riders owned by the incoming side whose `expiresOnTurn <=
  turnNumber`. With `expiresOnTurn = N + 0.5` the rider survives the opponent's
  turn and is gone at the start of the owner's next — exactly "until the start
  of your next turn". Turn numbers advance by 0.5 per player turn.
- **R-4 — Not spent by a battle.** The rider stands for the whole window and
  every battle in it, rather than being consumed by the first. Flanking Maneuver
  is spent because its owner chooses the battle; Hold the Line's owner does not,
  and a spent-on-first-battle reading would let the opponent bait it away with a
  throwaway skirmish before the real attack.
- **R-5 — One side per battle.** Both players could in principle hold the line
  in the same zone. `scrappySide` is a single `Side`, matching `fragileSide`;
  the design does not support a simultaneous grant to both. In practice only one
  player is OW, so this is unreachable — but the field shape is the reason, and
  a two-sided variant would need a `Side[]`.
- **R-6 — Whole fleet, not standing zone.** Every hull the owner has in the
  battle is covered, mirroring the spec §3.8 ruling that Flanking Maneuver's
  "enemy ships" means the whole enemy fleet. The zone **arms** the power; it does
  not scope which of the owner's participants benefit.
- **R-7 — Summons are untouched.** Battle summons (spec §4.4) evaporate on
  report approval regardless of HP and are already excluded from the repair
  tally by `!isSummon(battle, id)`. Scrappy is moot for them; no special case.
- **R-8 — Bombardments are not battles.** A base attack involves no repair, so
  the rider has no interaction with `ATTACK_ENEMY_BASE`.
- **R-9 — Same gate as every other faction power.** Own turn only, not while a
  battle is frozen, 1 CP, once per game, and 403 for a non-OW deck via
  `FACTION_POWERS`.

## 6. Files touched

**Shared engine** (every change here needs `npm run functions:sync` in the same
commit — `supabase/seed/functionSharedSync.test.ts` fails otherwise):

| File | Change |
|---|---|
| `shared/engine/heroPowers.ts` | `holdTheLine()` replaces `changeOrder()`; `FACTION_POWERS.holdTheLine = 'OW'`; export `HOLD_THE_LINE_EFFECT` / `_NAME`; dispatch branch in `USE_HERO_POWER` |
| `shared/engine/engineTypes.ts` | `scrappySide?: Side` on `ActiveBattle`, beside `fragileSide` |
| `shared/engine/gameInit.ts` | mirror `scrappySide?: 'a' \| 'b'` in the public battle shape — this file must **not** import `engineTypes.ts` (the lobby-action manifest does not carry it) |
| `shared/engine/battleDeclare.ts` | `applyHoldTheLine()` beside `applyFlankingManeuver()`, same call site |
| `shared/engine/battleResolve.ts` | `scrappyInBattle()`; `repairCostOf` takes battle + side |
| `shared/engine/gameEngine.ts` | incoming-side rider expiry sweep (R-3) |

No new `gameSettings.ts` constant: the power has no tunable number.

**Frontend:**

| File | Change |
|---|---|
| `pages/game/HeroPowerBar.tsx` | OW entry → `holdTheLine`; OW moves from the hand-picker to the zone-picker; drop the `changeOrder` eligible-cards gating |
| `pages/game/GameBoardPage.tsx` | `flankMode` currently sends `flankingManeuver` unconditionally at line 238 — generalize it to carry which power armed it |
| `pages/game/BattleOverlay.tsx` | **five** `repairCostOf` call sites gain the battle argument |
| `pages/game/zoneEffectBadges.ts` | `holdTheLineEffect` badge — visible to **both** players, as Flanking Maneuver's is |

**Make the new `repairCostOf` parameters required, not optional.** There are
six `repairCostOf` call sites across the engine and `BattleOverlay` (one in
`battleResolve.ts`, five in the overlay), and the overlay's are what
decide *what the player is offered*. An optional parameter would let a missed
call site silently offer a repair the engine then refuses — the exact failure
`fragileInBattle`'s own comment warns about. Required parameters make the
compiler enumerate them under TS strict.

**Data and docs:** `supabase/seed/source/heroPowers.js` (the OW row),
`docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` §3.8 (the OW bullet),
and `docs/claude/architecture.md`, which names `changeOrderDraw` in three places.

### 6.1 What stays behind on purpose

**Keep `changeOrderDraw` in the `scheduled` union and keep its redelivery
branch.** Only the power that *creates* the item goes. A game in flight may
already carry one, and the loop's own comment records why the type check is part
of the carry-forward condition: a loop that consumed every due item of its side
would silently eat types it cannot handle. The stale item resolves to its
harmless fizzle and is dropped.

Likewise a stale `'changeOrder'` string may sit in `state.usedHeroPowers` on an
existing game; nothing reads it except the already-used check, and the dispatcher
falls through to a clean `400 Unknown hero power` if an old client sends it.

This follows the `DELIBERATE_ORPHANS` precedent (`bulwarkOnPlay`).

## 7. Test plan

Card effects and powers are TDD (CLAUDE.md): failing engine test first, then
implement, then the full suite with the before→after passing count reported.

- **`heroPowers.test.ts`** — arms a rider on the chosen zone with the right
  `expiresOnTurn`; rejects a missing or unknown zone; rejects off-turn; rejects
  while a battle is frozen; spends exactly 1 CP; refuses a second use; 403s for
  a non-OW deck.
- **`battleDeclare.test.ts`** — `scrappySide` set at lock when the owner
  attacks in the armed zone, and when the owner **defends** there (R-2); not set
  for a battle in a different zone; not set for the opponent; the rider is
  **still standing** after the battle locks (R-4).
- **`battleResolve.test.ts`** — a hull at 85% in the armed zone repairs for 0,
  and the same hull without the rider owes half its effective cost; a Fragile
  hull at 85% is destroyed anyway (R-1); a hull at 79% dies regardless; a summon
  is unaffected (R-7); **two** battles in one window both benefit (R-4).
- **`gameEngine.test.ts`** — the rider survives the opponent's END_TURN and is
  swept at the start of the owner's next turn (R-3); a rider owned by the other
  side is carried forward untouched.
- **`zoneEffectBadges.test.ts`** — the badge renders for both players.
- `npx vitest run`, `npm --prefix frontend run build`, `npm --prefix frontend run lint`.

## 8. Migration and deploy — two traps

Both are live defects waiting to happen, and neither is caught by CI.

### 8.1 `seed:verify` does not cover `hero_powers`

`scripts/verify-seed.mjs` diffs the **`cards`** table only — it contains no
reference to `hero_powers`. So `npm run seed:verify` will report a clean
170/170 while the OW hero power row in production is still Change Order. The row
must be applied and confirmed **by hand** after merge, exactly as the SS/TG/WF
rows were on 2026-09-07.

Consider extending `verify-seed.mjs` to cover `hero_powers` as part of this
work; it is the third time this table has needed a hand-apply.

### 8.2 Renaming the power creates a second row rather than replacing one

`supabase/seed/transform.ts` derives the id as
`uuidv5('hero:<faction>:<name>', FTD_NAMESPACE)`. Renaming *Change Order* to
*Hold the Line* therefore produces a **different primary key**, and every
statement in `seed_data.sql` is `insert … on conflict (id) do update` —
**nothing is ever deleted**.

Applying the new seed will insert Hold the Line and **leave Change Order
standing**. `DeckBuilderPage.tsx:45` reads this table directly
(`.from('hero_powers').select('*')`), so an OW deck would render both powers,
one of which no longer exists in the engine.

The old row must be deleted explicitly:

```sql
delete from public.hero_powers where id = '78d7b7df-c926-593e-9ad9-543778c16ad8';
```

That id is `uuidv5('hero:OW:Change Order')` and is stable; it is recorded here so
the delete does not depend on the old name still being in the source tree.

### 8.3 Order of operations

1. Merge to `main` (deploys the edge functions automatically).
2. Verify `game-action`'s version incremented, **by content** — a deploy
   legitimately reads back with fewer modules because type-only imports are
   erased in transpilation.
3. Apply the `hero_powers` upsert for Hold the Line.
4. Apply the delete in §8.2.
5. Confirm by query that OW has exactly one row.

## 9. Non-goals

- **No card data changes.** No OW card is added, retired or re-costed.
- **No custom-ship pipeline.** Removing Change Order is not a decision about
  whether player-made ships ever ship; it is a decision that a hero power must
  not depend on a pipeline that does not exist.
- **GT still has no faction power.** Unchanged by this work.
- **`[GT] Damacy` is still mis-filed** as `faction: OW` while every other `[GT]`
  card is `faction: GT`, so Special Foundries and The Onyx Throne's activate
  cannot draw it. Noted during this design; it belongs in its own change.
