# Wave 7 close-out — the TG faction

**All 26 TG cards are built. `KNOWN_GAPS` is empty again.**

`npx vitest run` → **1132 passed / 34 files**, from a measured baseline of
**932 / 33**. `npx tsc -p tsconfig.json --noEmit` exits 0;
`npm --prefix frontend run build` exits 0; `npm --prefix frontend run lint`
exits 0 with **7** pre-existing warnings, none in a file this wave touched.

Mutation testing: **24 killed of 26**, with both survivors accounted for (§5).

---

## 1. The 26, card by card

| Card | Built as | Notes |
|---|---|---|
| Obsession | vanilla | upkeep 49,500/turn |
| Euphoria | vanilla | upkeep 87,000 |
| **Ecstasy** | vanilla | renamed from `Extasy` **before** the first seed |
| Optimism | vanilla | — |
| Frustration | vanilla | an **airship** carrying `SUB_SCREEN`; `screenBlocks` does not care what type the screening hull is |
| Joy | vanilla | the only upkeep card without `ROBOTIC` |
| Amusement | vanilla | upkeep 49,500 |
| Audacious | vanilla | — |
| Spite | vanilla | — |
| Loathing | vanilla | — |
| **Curiosity** | `additionalSpawns: 1` | no registry name at all |
| **Acceptance** | `resourceSurge` | §4.6's suppressing arm; ruling A-1 |
| **Jealousy** | `jealousyOnDeath` | `basherOnDeath` verbatim |
| **Fear** | `fearOnPlay` | one Horror per zone; reaches the land zone a ship cannot be *played* into |
| **Obelisk** | `obeliskBattle` | a Mirth Swarm battle summon, at lock only |
| **Hysteria** | `hysteriaOnPlay` | a board-wide choice granting `INOFFENSIVE` |
| **Alarmed** | `deployRequiresAiVehicle` + `alarmedOnPlay` | rulings D-1, D-2 |
| **Horror** | `horrorBattle` | rulings D-3, D-4 |
| **Nostalgia** | `nostalgiaOnDeath` + `returnToHand` | ruling E-1; three divergences pinned |
| **Vengeful** | `vengefulBattle` + **DP8** | rulings E-2, E-2b, E-3, E-4 |
| **Havoc Factory** | `havocFactoryEffect` | a per-hull rider; ruling E-5 |
| **Mirth Factory** | `mirthFactoryEffect` | same mechanism, its own swarm |
| **Duel** | `duelEffect` + `crossZone` | rulings E-7, E-8, E-9, **E-10** |
| Havoc Swarm | `summonOnly: true` | cost corrected 1,200,000 → 120,000 |
| Mirth Swarm | `summonOnly: true` | — |
| **Anguish** | `EXEMPT`, permanently | deployment-order conduct text; the engine has no such concept |

Plus the three things that are the wave and none of which is a card:
`DECK_FACTIONS` gains `TG`; `UPKEEP_REQUIRED` becomes a keyword **and** an
`endTurn` rule; and the LH `[TG] Robotics` pool is narrowed to a marker.

---

## 2. Where the handoff was wrong

Six findings. The first changes a ruling; the last withdraws a decision that
was escalated to the owner and should not have been.

1. **"The engine has no AI concept" (ruling D-1) is false.** Spec §7.3's
   *first* ruling defines "AI" as `isBuiltIn === true`; `OW:Garrison` prints the
   identical phrase (*"Target an AI vehicle in hand"*); and `owEffects.ts:138`,
   `ssEffects.ts:86/127` and `wfEffects.ts:169` all implement it. The handoff's
   `ROBOTIC` recommendation would have given one printed phrase two meanings,
   which decision 1 forbids. **Alarmed reads `isBuiltIn`.** Recorded
   consequence: in a TG deck almost every hull is built-in, so clause 1 reduces
   to "you already hold this zone" — a mild restriction, and the price of a
   consistent glossary.
2. **`DECK_FACTIONS` is not what `validateDeck` reads.** `validateDeck` never
   references it; it compares `card.faction !== deck.faction`. The only
   functional reader is `frontend/src/pages/DecksPage.tsx`. Same fix, different
   reason — and it moves the only end-to-end check from the engine suite to the
   browser (§4).
3. **A missing `KEYWORD_INFO` entry does not "ship unnoticed".**
   `frontend/src/lib/keywords.test.ts` iterates `Object.values(KEYWORDS)` and
   went red on cue.
4. **`smoke-lib.mjs` was already extracted.** The kickoff asked for
   `signIn`/`buildDeck`/`startGame`/`step` to be pulled out first; wave 6 did it
   in `805a301` and the file exports thirteen helpers. A whole task the wave did
   not need.
5. **"Eight of the ten upkeep cards carry `ROBOTIC`" — it is nine.** Joy is the
   only one without.
6. **The upkeep-versus-income warning is withdrawn, not accepted.** The handoff
   raised "Fear plus three Horrors is 151.5k, more than a full turn's income at
   turn 2" as a balance decision for the owner. Both numbers are right and the
   comparison is not: income is **set** to `floor(turnNumber) × rate`, never
   accumulated, so an 800k card is unplayable until **turn 11**, where income is
   825k and its upkeep is 14.5% of it — the same ratio Horror pays at turn 1.
   **The 15% rate is scale-invariant by construction** (spec §7.3, U-8), so it
   needs no per-card tuning at any cost or any lobby rate. There was no decision
   to make.

---

## 3. What the wave found that nothing was looking for

### The seed has a second copy of the keyword vocabulary

`supabase/seed/source/*.js` import `"../gameSettings"`, which is
`supabase/seed/source/gameSettings.js` — **not** `shared/gameSettings.ts`, and
nothing connected the two. So after `UPKEEP_REQUIRED` was added to the shared
file, `KEYWORDS.UPKEEP_REQUIRED` still evaluated to `undefined` in all ten cards
that print it, and `seed_data.sql` was generated carrying:

```
'Fear' ... '["blocker","robotic",null]'::jsonb
'Joy'  ... '[null]'::jsonb
```

No error, no log line, and every guard green — G1/G2/G3 read effect *names*, not
keywords, and `balancePass` covers no TG card. Ten cards would have seeded inert
and the upkeep rule would have billed nobody. **Only the seeded-VALUE assertions
saw it**, which is the case `card-effects.md` makes as blind spot 4.

Fixed in both halves: the keyword is in the seed vocabulary, and a new drift
guard asserts the two `KEYWORDS`/`TRIGGERS` maps agree in both directions and
that every seeded faction and vehicle type is one the engine knows.

### A capture would have become a theft

`discardSnapshotOf` **strips** `meta.ownerSide` when filing a captured card into
its owner's pile — correct there, because a card in its owner's discard is home.
But `returnToHand` puts it back in the **captor's** hand, still on loan. The
first implementation took the stripped snapshot, so a captured Nostalgia would
have come back unmarked and later been filed under the captor — one card gone
from the victim's deck, every time it died. Caught by the test written for the
ruling, not by the ruling itself.

### Duel could send an Inoffensive hull to attack

Found by the **late re-read**, not by building the card — which is the third
wave running that this pass has justified itself. Duel's friendly pick becomes
`attackerIds[0]` of a forced battle, and §7.3's Gang Up ruling is explicit that
`INOFFENSIVE` means "cannot attack, and a forced battle is not licence to break
that". Live-reachable: TG Hysteria grants `INOFFENSIVE` to an *enemy* vehicle,
so facing any TG deck one of your own hulls can carry it. Fixed in both the
offer and the resolve-time re-check, and recorded as **ruling E-10**.

---

## 4. What is verified, and how

| Verified | By |
|---|---|
| all 26 cards' costs, keywords, types and the 8/8/4/3+3 split | `tgFaction.test.ts`, spelled out rather than derived |
| the ten upkeep charges, and that **no** card carries both `UPKEEP_REQUIRED` and `HALF_COST` | same — the second is what makes ruling U-1 unobservable, so it is asserted |
| rulings U-1 and U-2 | fixtures carrying both keywords / a non-round cost; no real card can separate them |
| the LH pool stays at exactly four, by name and by count | `tgFaction.test.ts` + `factionEffects.test.ts`, from both ends |
| L-1 — the four borrowed rows keep every field | per card, plus "none of them gains `UPKEEP_REQUIRED`" |
| the four cross-zone sites | each with a cross-zone case **and** a single-zone regression |
| **TG appears in the real deck builder** | browser, against the running dev server: the `<select>` carries exactly `["DWG","GT","LH","OW","SS","TG","WF"]` |

That last one is the check the kickoff singled out, and no engine test could
have made it — `DECK_FACTIONS` is a `DecksPage` gate, not a `validateDeck` one.

---

## 5. Mutation testing — 24/26

**The harness was proved able to fail for the right reason first.** Wave 6
scored a perfect 62/62 that was entirely false, every kill coming from a drift
test that fails for any `shared/` edit. Wave 7's proof: mutating `Math.ceil` →
`Math.floor` in `costs.ts` was killed by exactly one named test — *"U-2: rounds
up, matching repairCostOf"* — and by nothing else.

`supabase/seed/tgFaction.test.ts` was added to the harness scope, because that
is where this wave's data assertions live.

**Both survivors are unreachable guards, not missing tests**, and that was
established by reading the callers rather than by assuming it:

- **Vengeful's `found.side !== actor`.** Every dispatch hands `fire` the side
  the entry was found on, and instanceIds are unique. The `!found` half of the
  same line is live and *is* killed — that is ruling E-2b.
- **Hysteria's enemy-side re-check.** While `pendingEffect` stands,
  `applyAction` admits only RESOLVE/CONCEDE/ABANDON and excludes
  `USE_HERO_POWER`, so nothing can trade the target to the other side (Boarding
  Party) between the offer and the answer.

The Hysteria survivor earned its keep beyond the comment: it exposed that the
original check was a full `enemyVehicleOptions()` re-scan that `findVehicle`
already subsumed for the "hull left the board" case — which is *why* it
survived. Replaced with an explicit side check. Neither survivor got an
invented test; both stay in the set labelled `UNREACHABLE`, so a change that
makes them reachable shows up as a newly-killable mutation rather than silence.

---

## 6. Still unverified

**Nothing has been deployed and the seed has NOT been applied.** Everything
below is blocked on that, and both are the owner's calls.

- **The whole live suite.** `scripts/smoke-wave7.mjs` is written and
  syntax-checked but **has never run**. It needs `game-action` deployed and
  `supabase/seed/seed_data.sql` applied by hand — merging to `main` deploys
  functions and **never** reseeds card data (wave 6 close-out §6.1 records a
  precedent for that being forgotten, with five cards inert in production).
- **The catalog probe for four new names**, which is the single most
  production-only failure mode in the wave: `makeCtx` hands every unit test a
  catalog, so a missing `{ needsCatalog: true }` is invisible locally.
- **The Factory escort's probe path specifically.** It works only because the
  probe scans every meta VALUE regardless of key and the stamp's value is the
  effect's own registry name. Nothing local exercises that reasoning.
- **A cross-zone `ActiveBattle` through jsonb.** A battle whose defender is not
  in its own `zoneId` is a shape production has never stored.
- **Upkeep through a real turn**, and `factoryEscort` surviving (or not
  surviving) a real `reshuffleDiscard`.
- **The `KEYWORD_INFO` badge and the amended Submarine glossary in the UI.**
  Never looked at. ⚠ `read_console_messages` returns a cumulative buffer that
  survives reloads, so a **fresh tab** is the only honest way to read it.
- **Two in-flight games** (recorded in wave 6's close-out) carry frozen
  pre-wave-7 snapshots and will keep playing under the old data. That is spec
  §9.2 working as designed; the *code* changes reach them immediately, which is
  worth knowing for the upkeep rule specifically — it reads keywords off the
  board, and those hulls have none.

---

## 7. The thing most worth carrying forward

Wave 5's lesson was to re-read the primary source after building against it.
Wave 6's was to check that your instrument measures what you think it measures.
Wave 7's is narrower and, on this evidence, sharper:

**A guard that reads data is only as good as an assertion on the data's VALUE.**

Every one of this wave's three real findings was a value that was structurally
fine and semantically wrong: a keyword array containing `null`, a meta object
missing `ownerSide`, a hull list containing a keyword that forbids the very
thing it was about to do. None produced an error. Two of the three were caught
by an assertion written *for a ruling*, not for a bug — which is the argument
for writing rulings down as tests rather than as comments.

The corollary the kickoff asked for, and which held: **after each step, ask what
would still look fine if you had got it wrong, then go check that specific
thing.** The `[null,"robotic"]` seed looked fine. So did a green suite.
