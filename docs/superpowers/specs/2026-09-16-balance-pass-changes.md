# 2026-09-16 balance pass — changes

Source: `changes20260916.js` (external baseline `7f85235`, diffed by card name).
**Every delta below is against THIS repo's seed rows at `main` `dc4182a`**, not
that baseline; §5 lists where the two disagree and which wins. 2 cards new to
the repo, 31 updated, 1 retired. Where this file and the 2026-09-02 spec
disagree, this file wins (it reverses that spec's R-5 for seven cards).

Workflow is unchanged and not repeated here: CLAUDE.md hard rules,
[card-effects.md](../../claude/card-effects.md) (failing engine test first,
one unique registry id per card, `functions:sync`, `seed:build`), retirement
per [2026-09-02 §2.1](2026-09-02-balance-pass-design.md). After merge:
`npm run seed:verify`, then hand-apply `seed_data.sql`.

Notation: cost = `materialCost`, bp = `blueprintCost`, kw = `keywords`,
`+X`/`−X` = keyword added/removed. Unlisted fields are unchanged; every card is
`isBuiltIn: true`, `cpCost: 0` (except Mutiny, 1 CP since the 2026-09-22
hotfix — §3). Rows live in
`supabase/seed/source/builtInCards/<FACTION>-built-in.js`.

## 1. Mechanics (engine work, cross-card)

**M-1 "AI ship" = `isBuiltIn && type 'vehicle' && vehicleType 'ship'`, any
faction.** Reverses 2026-09-02 R-5 for Victoria, Trondheim, Excalibur, Nothung,
Resolute, Argonaut, Sacrilego. Cuts both ways: a built-in DWG hull now
qualifies, a player-made SS ship no longer does. Motivation: a DWG-stolen SS
card must keep working in a hand holding no SS ships. **Repairmen Ready stays
`faction === SS`** (`shared/effects/ssEffects.ts:182`); Excruciator already
reads built-in — untouched.
Code: `ssEffects.ts` `SS_SHIP_FILTER` → `AI_SHIP_FILTER = { isBuiltIn: true,
type: 'vehicle', vehicleType: 'ship' }` (`PoolFilter.isBuiltIn` already
exists, `primitives.ts:82`); `isSsShip` → `isAiShip`, still exported —
`frontend/src/pages/game/HandBar.tsx:5` imports it for hand-target
highlighting, rename there too. Read the L-1 note above `SS_SHIP_FILTER` before
widening a catalog pool. Effects: `victoriaOnPlay`, `trondheimOnDeath`,
`excaliburEffect`, `nothungOnPlay`, `resoluteOnPlay`, `argonautOnDeath`,
`sacrilegoBattle`.

**M-2 Mirth Factory targets a friendly AI ship** (M-1 predicate), not a
ROBOTIC vehicle. `tgEffects.ts` `factory()` hard-codes the ROBOTIC test for
both factories (`:636`); parametrise the predicate — `havocFactoryEffect`
keeps ROBOTIC (its text still says robotic), `mirthFactoryEffect` uses
`isAiShip`. The own-side check stays (ruling E-5). TG's robotic non-ships stop
being targets; Obelisk (a TG built-in ship) becomes one.

**M-3 Mirth Swarm battle cap: at most one per side per battle**, however it got
there. Spawners: `obeliskBattle` (`tgEffects.ts:78`) and the
`mirthFactoryEffect` escort (`:623`); Mirth Swarm is `summonOnly`, so nothing
else adds one. A second spawn on a side is skipped and logged, not failed.
Express it as a data key on Mirth Swarm (e.g. `battleCap: 1`) checked at
`joinBattle`; the key **must** go in `DATA_EFFECT_KEYS` because Mirth Swarm now
has text and no effect name (G2 `silent` check — `slotDenial` precedent,
2026-09-02 §4.1).

**M-4 Mutiny (new DWG ability, 400k; 600k and 1 CP since the 2026-09-22
hotfix): steal an enemy vehicle for one turn.**
`playOnVehicleEffect`. PLAY_CARD_TARGETING_CARD_ON_FIELD does not check
ownership (E-5), so the effect must require `found.side === otherSide(actor)`
(`flyingSquirrelAttackEffect` shape). Move the entry from `zone.cards[enemy]` to
`zone.cards[actor]` in the same zone and `grantKeywordsTo(entry, [TEMPORARY])`;
the start-of-turn cull (`gameEngine.ts:457`) removes it. No control-change
primitive exists — new engine ground. §4 Q1–Q2.

**M-5 Sinners Luck (rework): optional swap.** `onPlayEffect` with a two-step
choice (friendly airship, then enemy airship-or-plane) that may be declined
(`krakenOnPlay` null-choice shape; `braveheartActivate` two-step shape). The two
hulls exchange side and zone. If `given.materialCost < received.materialCost`,
the opponent draws one card and it gets `costDelta −(difference)`
(`discountInHand`). The drawn card sits in a hidden hand — the log must not
name it. §4 Q3–Q4.

**M-6 Albacore's self-lock narrows to "another Albacore"** = `uniquePerZone:
true` (the wave-8 Obelisk mechanic, per side) replacing `aircraftLock`. Tarpon
drops `aircraftLock` outright. That leaves `aircraftLocked` (`placement.ts:54`)
with no carrier: keep it, commented, per 2026-09-02 R-8; do not delete the key.
(Amended 2026-09-23 at the owner's request: Tarpon gets `SUB_SCREEN` back beside
this pass's `AIR_SCREEN`; `FRAGILE` stays off. The summary row below records
what this pass did.)

**M-7 Tyr's decay floors at 500k.** `tyrCostModifier` (`ssEffects.ts:793`)
returns `max(−(materialCost − TYR_MIN_COST), −TYR_HAND_DISCOUNT × steps)`, new
`TYR_MIN_COST = 500_000` in `shared/gameSettings.ts`. This is a card floor, not
the `effectiveCostInGame` zero-floor the comment above it forbids duplicating —
amend that comment. §4 Q5.

**M-8 Flying Squirrel Attack sends two squadrons.** The engine models one "3x
squadron" as 3 hulls (`FLYING_SQUIRREL_ATTACK_COUNT = 3`); two → **6**.

**M-9 Horror is retired, not deleted.** `meta.retired: true`; the row stays
seeded and `horrorBattle` stays registered (Harbringer precedent).
`retirement.test.ts` `RETIRED` += `'TG:Horror'`. Fear's rewrite (§2 TG) removes
the last spawner. Count live decks holding it before merge
(`decks.cards ? '<id>'`, id = `cardId('TG', 'Horror')`); the DecksPage /
DeckBuilder affordance is generic.

**M-10 Orphans.** `spectreOnPlay`, `scourgeOnPlay`, `disembowelerOnPlay` lose
their card: delete the `meta` key, keep the registration, add each to
`DELIBERATE_ORPHANS` (`supabase/seed/effectCoverage.test.ts:239`, one per line
with its reason). `fearOnPlay`, `slasherOnPlay`, `sacrilegoBattle`,
`tyrCostModifier` are rewritten in place — only their own card names them.

## 2. Card deltas

### DWG
| Card | Delta | Code |
|---|---|---|
| **Mutiny** (new) | §3 | new `mutinyEffect` (M-4) |
| **Brigand** (new to repo) | §3 | new `brigandOnDeath` `{ needsCatalog: true }`: mint a Mutiny from the catalog into hand via `putInHand` (`slasherOnPlay` shape). SCRAPPY + death trigger is allowed (rule 10 as corrected; Argonaut precedent) |
| Buccaneer | cost 225k→220k; kw −FRAGILE +SCRAPPY | none; `spawnBuccaneerEffect`'s explicit `keywords: [SCRAPPY]` becomes redundant, harmless |
| Spawn Buccaneer | text: drop "It is not temporary." | none (Buccaneer never printed TEMPORARY) |
| Sinners Luck | text "" → §3; kw −SCRAPPY | new `sinnersLuckOnPlay` (M-5) |
| Tarpon | text → ""; kw −FRAGILE −SUB_SCREEN +AIR_SCREEN; meta −`aircraftLock` | M-6 |
| Albacore | text → "While this vehicle is alive, you may not play another Albacore into this zone"; meta `aircraftLock` → `uniquePerZone: true` | M-6 |
| Loggerhead | kw +HALF_COST (undoes 09-02's removal; SCRAPPY is still not restored) | none |
| Pilferer | cost 130k→100k | none |
| Flying Squirrel Attack | text "against a flying squirrel" → "against two flying squirrel" | M-8 |

### SS — the seven "SS ship" → "AI ship" cards (M-1); texts are the exact new strings
| Card | New text | Other |
|---|---|---|
| Victoria | When played, pick one AI ship in hand and reduce its cost by 75k | |
| Trondheim | When this vehicle is destroyed, draw an AI ship and reduce its cost by 75k | still `source: 'deck'` though the text dropped "from your deck" |
| Excalibur | Pick one AI ship in hand and reduce its cost by 200k | |
| Nothung | When played, reduce the cost of all AI ships in your hand by 40k | |
| Resolute | When this vehicle is played, draw an AI ship from your deck. reduce its cost by 40k | |
| Argonaut | When this is destroyed, reduce the cost of a random AI ship in your hand by 50k | |
| Sacrilego | Whenever this vehicle survives a fleet battle, reduce the cost of AI ships in hand by 30k. | kw −MOBILE (keeps SCRAPPY, STEALTHY). `sacrilegoBattle`: delete the fleet-wide SCRAPPY grant; keep the survive-discount |
| Tyr | This card costs 60k less for every turn it spends in your hand. Min 500k | kw +FRAGILE; M-7 |
| Spectre | (empty) | meta −`onPlayEffect`; orphan (M-10). The CP drain is gone |
| Blockade | (unchanged) | cost 100k→120k |

### TG
| Card | Delta | Code |
|---|---|---|
| Fear | text → "When this vehicle is played, draw a card" | `fearOnPlay` → `grant({ draw: 1 })`; drop `needsCatalog` |
| Mirth Swarm | text "" → "No more than one mirth swarm can participate in any one battle on a single side, even if spawned in by card effect" | M-3 data key |
| Mirth Factory | text "Target friendly robotic vehicle." → "Target friendly AI ship." (rest unchanged) | M-2 |
| Obelisk | cost 40k→60k; kw −STEALTHY; text gains a full stop and, in the changelog, lacks the wave-8 clause "You may only control one Obelisk per zone" | §4 Q6. `obeliskBattle`'s "Obelisk is STEALTHY" note and any test routing through RESPOND_TO_ATTACK go stale |
| Audacious | kw +FRAGILE | none |
| Spawn Audacious | cost 40k→400k | none; §4 Q7 |
| Horror | retired | M-9 |

### OW
| Card | Delta |
|---|---|
| Bulwark | cost 450k→600k |
| Eyrie | cost 575k→650k |

### WF
| Card | Delta | Code |
|---|---|---|
| Scourge | text → ""; kw +BLOCKER | meta −`onPlayEffect`; orphan `scourgeOnPlay` (M-10) |
| Disemboweler | text → ""; kw +STEALTHY | meta −`onPlayEffect`; orphan `disembowelerOnPlay` |
| Slasher | text → "When this is played, add an earth raker to your hand. it costs 0." | `SLASHER_EARTH_RAKER_COUNT` 2→1 |
| Basher | text → "When this vehicle is destroyed, draw a card" | none — already `onDeathEffect: basherOnDeath` here (§5) |
| Purifier | cost 750k→760k (reverts 09-02) | none |

## 3. New rows

**Mutiny** — DWG, `type: 'ability'`, cost 400000 (amended 2026-09-22, owner
hotfix: cost **600000** and `cpCost: 1`), bp 0, `vehicleType: null`,
`imageUrl: 'mutiny.png'` (file convention), meta
`{ playOnVehicleEffect: 'mutinyEffect' }`.
Text: `Choose an enemy vehicle, gain control of it and give it temporary`

**Brigand** — DWG, `type: 'vehicle'`, `vehicleType: 'ship'`, cost 350000,
bp 356000, kw `[SCRAPPY]`, `imageUrl: 'brigand.png'`, meta
`{ onDeathEffect: 'brigandOnDeath' }`.
Text: `When this is destroyed, draw a copy of Mutiny`
The changelog files Brigand under "updated", but it has never been seeded here
(nor in the 09-02 file) — treat as new; its id derives from `card:DWG:Brigand`.

**Sinners Luck** text (exact): `when played, you may swap a friendly airship
with an enemy airship or plane. If airship you provide is worth less than what
you get, the opponent draws a card and reduces that cards cost by the
difference.`

## 4. Rulings — taken 2026-09-16, binding on this pass

- **Q1 Mutiny, full zone: REFUSE the play.** `mutinyEffect` returns `false`
  when `zone.cards[actor].length >= zoneCapFor(state, actor, zone.id)` — and
  also when `uniquePerZoneBlocked(state, actor, zone.id, target)` would trip
  (stealing a second Albacore/Obelisk into a zone you already hold one in).
  The same two gates `moveEntry` applies to walking a hull in. The 400k is
  never spent: the handler 400s and `applyAction` discards the clone.
- **Q2 Mutiny, expiry: the ORIGINAL OWNER's discard.** Mutiny stamps
  `meta.homeSide = <side it was stolen from>` on the stolen entry;
  `discardCard` files a hull under `homeSide ?? controller`, and
  `discardSnapshotOf` strips the stamp. This covers the turn-start cull AND a
  stolen hull dying in battle — either way it goes home, so it can reshuffle
  into the deck it belongs to.
- **Q3 Sinners Luck "swap": exchange side AND zone.** Airships and planes fly
  in every biome, so no biome check is needed. The swap bypasses the zone
  cap (it is not a play, and is net-zero per side — Boarding Party's latitude)
  and does not consult `uniquePerZone` (recorded edge: a swapped-in Albacore
  may land beside the receiver's own).
- **Q4 Sinners Luck "worth": printed `materialCost`.** The difference is
  stamped as `costDelta −(received − given)` on the card the opponent draws;
  the log names neither the card nor its price.
- **Q5 Tyr "Min 500k": floors Tyr's OWN decay only.** `tyrCostModifier`
  returns `max(−60k × steps, −(materialCost − TYR_MIN_COST))`; other
  `costDelta` stamps (Excalibur, Nothung, …) still apply beneath the floor.
- **Q6 Obelisk: keep `uniquePerZone` and its text clause**; take the cost
  (40k→60k) and the STEALTHY removal.
- **Q7 Spawn Audacious: 400k, as the entry says.** It closes the recorded
  40k Spawn Audacious → Repurpose-for-330k loop (`tgEffects.ts`), which
  reads as deliberate rather than a typo.
- **Q8 Silent moves: implemented as listed.** Buccaneer 220k, Pilferer 100k,
  Blockade 120k, Obelisk 60k, Spawn Audacious 400k, Bulwark 600k, Eyrie 650k,
  Purifier 760k; Loggerhead +HALF_COST; Audacious and Tyr +FRAGILE.

Three engine details the sections above left open, each decided by the
nearest precedent:

- **D-1 A side change re-stamps `playedOnTurn`** (Mutiny's stolen hull; both
  Sinners Luck hulls), exactly as Boarding Party does. A stolen hull can
  therefore fight a fleet battle this turn but cannot BOMBARD
  (`baseStrikersIn` excludes fresh deployments). `movedOnTurn` and
  `activatedOnTurn` reset with it.
- **D-2 M-3's cap is enforced in `joinBattle`** (the two spawners) and
  nowhere else. It counts hulls already on that side of the live battle via
  `lockRoster` — board hulls and summons alike — keyed on `cardId`, read off
  the new `battleCap` data key (`DATA_EFFECT_KEYS`). The DECLARED roster of
  `ATTACK_ENEMY_FLEET` is not gated: two board Mirth Swarms (Drones plus a
  refresh in one turn) could still attack together. Recorded, not fixed.
- **D-3 Sinners Luck is a two-hop `choice()`** (Braveheart's shape).
  Declining is the existing `RESOLVE_PENDING_EFFECT { cancel: true }` path
  the dialog already offers; an empty pool at either hop resolves as "nothing
  happens" (Kraken's null shape), so the ship still deploys.

## 5. Changelog vs repo — where they disagree

- **Basher:** changelog says the draw "moves from play to destroyed"; this repo
  already has it on death. Wording change only, no engine work.
- **Obelisk:** Q6.
- **Brigand:** "updated" there, absent here — new (§3).
- Six values the 09-02 spec set (Buccaneer 225k, Bulwark 450k, Eyrie 575k,
  Purifier 750k, Spawn Audacious 40k, Obelisk 40k) are moved again by this file.

## 6. Guards that move

- `npm run seed:build` after every source edit (`seedDataSync.test.ts`).
- Pinned literals: grep each touched card in `supabase/seed/balance/*.balance.test.ts`,
  `balancePass.test.ts`, `tgFaction.test.ts` (86 hits at time of writing) and
  move them with the data.
- `retirement.test.ts` `RETIRED` (+Horror); `effectCoverage.test.ts`
  `DELIBERATE_ORPHANS` (+3), `DATA_EFFECT_KEYS` (+Mirth Swarm cap key);
  `shared/gameSettings.test.ts` if it pins a moved constant; an engine test per
  new or rewritten effect.
- Report the before→after passing count; deploy with
  `npm run functions:deploy -- game-action` and verify the version bumped;
  `seed:verify` after merge; then list any effect here still unimplemented.
- Close-out (2026-09-16): implemented by `docs/superpowers/plans/2026-09-16-balance-pass.md`.
  Not built by design: gating `ATTACK_ENEMY_FLEET`'s declared roster on
  `battleCap` (ruling D-2); a `uniquePerZone` check on Sinners Luck's swap
  (Q3). `scripts/smoke-wave6.mjs` was updated in the fix round: its seed
  check asserts Albacore's `uniquePerZone` and Tarpon's empty meta in place
  of the `aircraftLock` M-6 removed, and its game-B scenario now proves the
  M-6 rule end to end (a second Albacore refused, the owner's other aircraft
  and the enemy's both allowed). Not re-run against the live backend in that
  round — the seed had not been applied yet.
- Sacrilego (M-1, spec R-8): a hull loaned SCRAPPY by the OLD lock-phase code
  in a battle still open at deploy keeps the loan after resolve until it
  dies (only `discardSnapshotOf` strips it now).
- Mutiny (M-4): `discardIndexOf` (`shared/engine/battleTriggers.ts`) searches
  the controller's discard, but a stolen hull is filed under its owner, so
  revive-on-death triggers (TG Nostalgia `returnToHand`, OW Iron Cordon
  `reviveEntry`) miss for a hull stolen by Mutiny and log "could not
  resolve" — fails safe.
- Mutiny (M-4): a stolen hull's death trigger fires for the THIEF —
  `battleResolve` pushes each casualty into `destroyedEntries` with the side
  it fought for, and `fireDeathEffect` takes that side as `actor` — so Mutiny
  on a Brigand, Trondheim, Argonaut or Iron Maiden followed by a suicide
  attack harvests the trigger (the Mutiny copy, the discounted AI ship, the
  hand discount, the draw) for the thief while the hull itself files home.
  Coherent with "gain control"; recorded, not changed.
- Sinners Luck (M-5, Q3): the swap also bypasses `aircraftLock` (no seeded
  carrier since M-6), a third unrecorded edge beside the cap and
  `uniquePerZone`.
- `uniquePerZone` joined `DATA_EFFECT_KEYS` (registry) on 2026-09-16 because
  Albacore's whole text is that rule and names no effect.
