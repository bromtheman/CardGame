# 2026-09-23 LH: EMP Torpedo, an answer to submarines — design

Amends the [2026-09-21 LH faction redesign](2026-09-21-lh-faction-redesign-design.md),
after the 2026-09-22 [Drain N Charge](2026-09-22-lh-drain-charge-design.md),
[card draw](2026-09-22-lh-draw-design.md) and
[hovercraft](2026-09-22-lh-hovercraft-design.md) amendments. Decisions taken
with the owner on 2026-09-23; where this document and an earlier one disagree,
this one wins. Narrows **R-12** ("LH is a timer faction, not a removal one"):
submarines are the exception. Amends **R-18**: Cathode is no longer the
roster's only active answer to a submarine.

## 1. Why

The owner: enemy submarines lock down LH's lanes. A lane that holds an enemy
sub cannot be cleared, because LH's attacks there do nothing to the sub.

- **The fight.** Battles are fought in From The Depths, and LH's lasers stop
  at the water. The owner's FtDArmament report rates no LH craft above 3/5
  against submarines, bench included (Anode, Cathode, Gigawatt and Tesla are
  the 3s). No hull swap fixes this in battle, so the answer has to be a card
  rule.
- **What LH had** was partial:
  - Three Sub Screens (Anode, Cathode, Candela) stop a sub being *played*
    into their lane. They do not touch a sub already there, and moving
    ignores them.
  - Stun (Ampere, EMP Salvo, Penumbra) switches a sub off for one enemy turn.
  - Cathode's duel is a turn-8 capital behind Drain 2. It fights once every
    other turn, on a 3/5 hunter's FtD odds.
- **The other factions.** WF has Sub Strike (100k + 1 CP: remove a sub) and
  Judgement (a sub duel every turn). OW has Sub Killer. LH had no way to clear
  a sub from a lane for good.
- **The subs LH meets:** SS Typhoon, Wolin and Cyclone; TG Spite, Vengeful and
  Agony (a Blocker); WF Pontus, Pulverizer and Disemboweler (Stealthy).
  PracticeAI's TG deck runs five.

## 2. Decisions

| Decision | Choice |
|---|---|
| Problem | **Lane lockdown.** Asked which sub problems they had hit, the owner chose only this one. Not chosen: subs sinking charged hulls, sub swarms, a gap on paper. |
| Approach | **A charge-paid removal ability**: WF Sub Strike's effect, paid in pips. Chosen over *a stunned sub cannot dive*, because FtD cannot hold one craft at the surface without new work in the in-game mod: the exported battle file's altitude rules apply to the whole battle, and the mod only reports the result. Also chosen over *a sub-only duel on Anode*: Anode rates 3/5 against subs, would duel once every other turn, and, being a sub itself, is kept out of a lane by an enemy Sub Screen. |
| Reach | **One sub per cast**, Sub Strike's reach. Chosen over "the target and every copy of it" and over "every sub in the lane". A Pontus or Pulverizer lane takes three casts. |
| Price | **100k, 0 CP, Discharge 2 from a friendly LH vehicle.** Sub Strike's 100k, with two pips in place of its CP, since LH has no CP generation (R-25). |
| Tether | The paying vehicle's lane, like every Discharge-from card (R-24). |
| Hand | **No new hand state** (owner). The card turns red like every Discharge-from card while no LH vehicle holds 2 charge (§3 rule 5). |
| Name | **EMP Torpedo.** |
| PracticeAI | In the LH bot deck in place of the second Chrysoprase. The strategy notes' submarine line names it. |
| Testing | TDD engine tests and one deterministic evaluator test; no self-play probe. The owner tests live. |

## 3. The card

| Card | Type · cost | Text | Registry id |
|---|---|---|---|
| EMP Torpedo (new) | ability · 100k · 0 CP | Discharge 2 from a friendly LH vehicle: remove target enemy submarine in that zone from play. | `empTorpedoEffect` |

Data: `meta: { [TRIGGERS.PLAY_ON_VEHICLE]: 'empTorpedoEffect', dischargeFrom: 2 }`,
EMP Salvo's shape.

1. **Paying.** The Discharge-from path is unchanged (2026-09-21 §3.2, R-20).
   The play targets a friendly LH vehicle that holds at least 2 charge and has
   not activated this turn. The engine spends the two pips and marks the
   vehicle activated before the effect runs. Feedback Loop draws for it like
   any discharge (draw amendment §6).
2. **Target.** The effect's second pick offers every enemy submarine in the
   paying vehicle's lane. The test is `vehicleType === 'sub'` exactly, so a
   hovercraft, which is a ship in every rule, is never offered.
   - Stealthy subs are offered. Stealthy only withdraws a defender from a
     fleet battle (spec §3.7), and Sub Strike already removes Disemboweler.
   - Stun makes no difference.
   - Decoy can redirect only to a Decoy that is itself a submarine (2026-09-21
     §3.6: Decoy "redirects, it never blanks"). None exists today.
3. **Removed, not destroyed.** This is Sub Strike's R-7 (2026-09-02 balance
   pass). The sub leaves through `discardCard`, the single exit out of play:
   a mutinied sub goes to its owner's discard, and a summoned or captured copy
   reaches no discard at all. No `onDeathEffect` dispatches. The log names the
   sub, which was public on the board.
4. **No sub in the lane.** `choice` resolves with nothing, the effect fails,
   and the play is refused with the whole clone rolled back: the card,
   materials and pips are untouched. The player sees "EMP Torpedo's effect
   could not resolve — check its target", as with EMP Salvo in an empty lane.
5. **The hand is unchanged.** HandBar's existing Discharge-from check already
   covers the card: a red ring and banner while no LH vehicle holds 2 charge.
   A sub-in-lane check was proposed and dropped: the owner ruled it a new hand
   state for one card.
6. **A declined pick** leaves the card and the pips spent, as with EMP Salvo
   (2026-09-21 §3.2).

Play patterns (informative, not rules):

- **Ampere** enters fully charged (hovercraft amendment). Play it into the
  sub's lane and pay the torpedo from it: 300k in one turn, and its on-play
  stun can still switch off another enemy there.
- A **Mobile** vehicle charged in a quiet lane (Dipole, Faraday, Megawatt,
  Angstrom) moves in with its pips and pays.
- **Overcharge** (1 CP) fills a fresh hull played into the lane (R-25).

Each of these removes the sub within LH's own turn, so the sub never gets a
turn against the paying vehicle.

## 4. Engine

- **`empTorpedoEffect`** lives in `shared/effects/lhEffects.ts`. It is a
  `choice` in EMP Salvo's shape:
  - `options` finds the paying vehicle through `hostLane` and offers
    `enemyVehicleOptions` in its lane, filtered to submarines;
  - `resolve` refuses a null pick and re-checks that the chosen vehicle is
    still an enemy submarine on the board;
  - it then removes the sub with Sub Strike's body: out of its zone, through
    `discardCard`, and a log line.
- **Its own id.** `subStrikeEffect` is not reused (the Kraken/Paddlegun
  collision; card-effects.md rule 2).
- **Nothing else in the engine changes.** `PLAY_CARD_TARGETING_CARD_ON_FIELD`
  already validates the paying vehicle, spends the pips, stamps the activation
  and fires Feedback Loop's draw. `lhEffects.ts` is already imported by
  `engine/index.ts` and listed for both functions in `shared-manifest.json`.
- **No `gameSettings` constant.** The card's only numbers are its cost and its
  discharge, both card data pinned by the balance test.
- **Seed:** one new row in `LH-Built-in.js` beside the other abilities
  (`imageUrl: 'empTorpedo.png'`). `npm run seed:build` then gives 195 cards.

## 5. PracticeAI

- **Deck** (`BOT_DECKS.LH`): Chrysoprase ×2 → ×1, plus EMP Torpedo ×1. The
  deck stays at 20 cards, with fliers unchanged at 3 of 6.
- **Finding the play needs nothing new.** The move menu tries each
  play-on-vehicle ability against every field id and keeps what the engine
  accepts, and the evaluator settles the pending pick. This is EMP Salvo's
  path.
- **No evaluator change.** Removing an enemy vehicle already scores, because
  the enemy's board value drops. The two pips cost 0.08 at `EVALUATOR.charge`
  0.04.
- **Strategy notes** (`factionNotes.ts`): the submarine line becomes

  > - Lasers stop at the water, so a fleet battle cannot sink a submarine. EMP Torpedo removes one for two pips from a hull in its lane — Ampere lands fully charged, so it can pay the turn it arrives — and Anode's Sub Screen keeps new ones out.

  `EMP Torpedo` joins `mentions`. The notes test pins every name there to
  the seed and to the deck.

## 6. Tests

TDD: each test fails before its implementation (docs/claude/card-effects.md).

- **`empTorpedoEffect`:**
  - it removes the chosen enemy sub from the paying vehicle's lane into its
    owner's discard; the vehicle loses 2 charge and is marked activated; the
    card is spent; the log names the sub;
  - a sub carrying an `onDeathEffect` is removed without the trigger firing;
  - it offers only submarines: an enemy ship and an enemy hovercraft in the
    lane are not offered;
  - it offers only the paying vehicle's lane: an enemy sub elsewhere is not
    offered;
  - it offers a Stealthy sub;
  - with no enemy sub in the lane it refuses the play, leaving the card in
    hand and the materials and charge unchanged;
  - it refuses a paying vehicle with 1 charge, and one already activated this
    turn (the shared path, pinned for this card).
- **Evaluator:** with a charged Ampere beside an enemy sub and EMP Torpedo in
  hand, `scoreMove` for the torpedo beats END_TURN.
- **Seed-backed** (`lh.balance.test.ts`): 100k, 0 CP, `dischargeFrom: 2`, the
  text and the effect id.
- **Guards:** coverage G1–G4 with `KNOWN_GAPS` unchanged; `seedDataSync` after
  `seed:build`; `functionSharedSync` after `functions:sync`;
  `botDecks.test.ts`; `factionNotes.test.ts`.
- The suite's passing count is reported before → after.

## 7. Delivery

One branch (`claude/lh-submarine-solution-ee8476`, up to date with `main` at
`96976c4`) and one PR. The data and its effect ship together, so the card
never ships ahead of its effect (2026-09-02 spec §1).

- **Gates before the PR:**
  - `npx vitest run`;
  - root `tsc`;
  - the frontend build and lint;
  - `functions:check`;
  - `functions:sync` and `seed:build`, both committed;
  - a secrets audit.
- **After merge:**
  - the `seed-apply.yml` run is green and `seed:verify` reports 195 cards,
    drift 0;
  - game-action and lobby-action are redeployed and read back by content
    (`empTorpedoEffect`, and "EMP Torpedo" in the notes);
  - Netlify rebuilds, since the merge touches `shared/`, and the
    `GameBoardPage` chunk carries `empTorpedoEffect`.
- **Owner, live:** play the card against a lane with a sub in it (the Ampere
  line), and see the red banner when no LH vehicle holds 2 charge.

## 8. Still open

- **Balance, live.** The card costs 100k and two pips per sub, so a Pontus or
  Pulverizer lane costs three casts. Revisit the reach if swarms lock lanes in
  play.
- **Sub Screens still ignore moves.** The keyword says "may not play", and
  this amendment leaves that alone.
- **Bench.** "A stunned sub cannot dive" remains the more LH-flavoured answer
  if the in-game mod ever learns to hold one craft at the surface.

## 9. Edits to the 2026-09-21 LH spec

Made in the same commit as this document:

- §2's submarine bullet names Anode (in place of Hydrovolt) and adds EMP
  Torpedo.
- R-12 and R-18 each carry an "Amended 2026-09-23" pointer here.
- §5's preamble cites this amendment, and §5.4 gains EMP Torpedo's row.
