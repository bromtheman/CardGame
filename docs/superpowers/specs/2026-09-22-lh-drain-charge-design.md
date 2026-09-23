# 2026-09-22 LH: "Requires N Charge" becomes "Drain N Charge" — design

Amends the [2026-09-21 LH faction redesign](2026-09-21-lh-faction-redesign-design.md).
Every ruling below was taken with the owner on 2026-09-22 and is binding on
the change that implements it. Where this document and the 2026-09-21 spec
disagree, this one wins; the 2026-09-21 spec is edited to point here (§9).

> **Superseded in part 2026-09-23.** [2026-09-23-lh-drain-discount-design.md](2026-09-23-lh-drain-discount-design.md)
> makes Drain an all-or-nothing discount. §2's precondition, the shortfall
> refusal and "exactly N or refused" no longer hold: a short board pays the
> printed price. The split rules (§2.1–§2.2) and the dialog's payer rows stand.

## 1. Decisions

| Decision | Choice |
|---|---|
| What changes | The whole-board charge gate is now **paid**: playing the card spends the pips. The 2026-09-21 spec checked the gate and never spent it (§3.3, R-14); the owner's intent was a cost. |
| Who pays | **The player picks** how much each LH vehicle gives up, in a dialog pre-filled with a suggested split (§2.1). PracticeAI always pays the suggested split. Chosen over an automatic order because every other charge spend in LH names its source, and a fixed order would sometimes drain a hull the player was saving. |
| Name | The printed line becomes **"Drain N Charge"** (was "Requires N Charge"). The data key stays `meta.requiresCharge`: games in progress hold frozen card snapshots, and a renamed key would make their capitals free. |
| Numbers | **Every gate drops by 1**: Dynamo 1, Quadrupole 2, Cathode 2, Terawatt 2, Candela 3, Impedance 4. Material costs are unchanged. Evidence in §7. |
| Playtest | Pre-merge and **headless**: two subagents with no shared context play full games on the new engine through a local referee (§8). The UI is checked in the browser after deploy. |

## 2. The rule (replaces 2026-09-21 §3.3)

`meta.requiresCharge: N`, printed **"Drain N Charge"**, is a play precondition
and a cost:

1. **Precondition** (unchanged): the sum of `charge` over the player's LH hulls
   in every lane must be at least N. "LH" is `faction === 'LH'`; player-made
   cards are NEUTRAL and never count. The hand states the reason the way it
   states "not enough materials": "Drain 3 Charge — you have 2".
2. **Cost**: playing the card from hand spends exactly N pips from the player's
   LH hulls, split across any number of them in any lanes, as the player
   chooses. Stealthy and stunned hulls may pay; Umbra's pips count while it is
   Stealthy, as before.
3. **Timing**: validated with the rest of the play; spent after materials are
   paid and before the hull lands. The card being played never pays: it is in
   hand, and it enters at 0.
4. **Not an activation**: paying never stamps `activatedOnTurn`. A hull that
   paid may still Discharge, or host a Discharge-from ability, with what it
   has left.
5. **Read and paid at play time only.** A hull already down stays down if its
   payers die later. Spawns ignore it (spawning is not playing, design spec
   §7.4); captures (Boarding Party, Mutiny) are not plays.
6. **Log** (public, since every payer is on the board), payers in board order:
   `Quadrupole drains 2 charge — Chrysoprase 1, Kilowatt 1`.

### 2.1 The suggested split

PracticeAI pays it, so does any client that sends no split, and the dialog
starts from it. One pip at a time:

1. While any hull with **no Discharge of its own** (no `meta.dischargeCost`)
   holds charge, take from the one holding the **most**, ties in board order:
   zones in `state.zones` order, then hulls in their `zone.cards[side]` order.
   A full battery wastes its next tick, and levelling several down lets the
   next tick refill them all.
2. Then take from hulls **with** a Discharge: the one holding the **least**,
   ties in board order. A nearly ready timer (Superradiance at 3/3) stays
   ready, and a timer already short is drained further before another is
   touched.

### 2.2 When there is no choice

The split is **forced** when the board holds exactly N, or when a single hull
holds all of the player's charge. The dialog is skipped and the engine applies
the only split there is.

## 3. Engine

- **Action.** `PLAY_CARD_TO_ZONE` gains an optional
  `chargeFrom?: { instanceId: string; amount: number }[]`.
  - **Absent:** the engine applies the suggested split (§2.1). This is
    PracticeAI's path, a stale client's, and the forced split's.
  - **Present, on a card with a gate:** every entry names a hull on the
    player's side of the board with faction LH; every amount is a whole number
    of at least 1 and at most that hull's charge; no hull appears twice; the
    amounts total exactly N. Any failure refuses the play with 400 and the
    reason. Nothing is spent on a refusal (the handler works on a clone).
  - **Present and non-empty on a card with no gate:** refused with 400
    (`<Card> drains no charge`).
- **Both deploy paths.** `PLAY_CARD_TARGETING_CARD_IN_HAND` (Excalibur's path)
  also deploys vehicles, and today skips the gate entirely. No LH card uses
  it, but it gets the same precondition and pays the suggested split. It gets
  no `chargeFrom` field, since no card needs one.
- **Helpers** in `shared/engine/charge.ts` are pure, exported through
  `engine/index.ts`, and imported by the engine, the dialog and the bot, never
  mirrored (frontend.md, "Never mirror engine logic"):
  - `chargePayersOf(state, side)`: the player's LH hulls holding charge, in
    board order.
  - `suggestedChargeSplit(state, side, amount)`: §2.1, or null when the board
    holds less than `amount`.
  - `chargeSplitError(state, side, amount, split)`: why a split is illegal, or
    null.
  - `chargeSplitIsForced(state, side, amount)`: §2.2.
  - One spend step shared by both handlers that applies a validated split and
    writes the log line.
- **Refusal wording**, one reason per failure: the chosen total is wrong ("choose
  exactly 2 charge — you chose 1"); a hull is short ("Kilowatt holds only 1
  charge"); a hull is listed twice; a source is not one of the player's LH
  hulls on the board. The existing shortfall refusal is reworded to the new
  name.

## 4. Frontend

- **`DrainChargeDialog`** (new, `frontend/src/pages/game/`), a board mode like
  `FleetAttackDialog`:
  - Title "Drain 2 charge for Quadrupole", and one line: "Choose which of your
    LH vehicles give up charge. Nothing is spent unless you play."
  - One row per payer, grouped by zone: the `MiniVehicle` chip (⚡n/m), the
    name, and a −/+ stepper from 0 to that hull's charge.
  - A counter, "2 of 2 chosen", marked when it is off. **Play Quadrupole** is
    enabled only when the total is exactly N. **Cancel** leaves the card in
    hand, and Escape or the backdrop cancel too.
  - It opens on the suggested split.
- **Flow.** Both vehicle-play paths, HandBar's one-legal-zone shortcut and
  GameBoardPage's zone click, go through one `playVehicle(card, zoneId)` in
  GameBoardPage. A gated card whose split is not forced opens the dialog;
  everything else sends at once, as today. That includes a gated card the
  board cannot pay: it sends, and the server's refusal shows inline like any
  other, beside the hand banner that already warned. The dialog clears
  through `cancelAllModes` like every other board mode.
- **Copy.** Every "Requires N Charge" becomes "Drain N Charge": the hand
  banner, the `PhysicalCard` footer chip (whose tooltip drops "The charge is
  not spent"), and the card-details row in `keywords.ts`, which reads:
  > Playing this drains N charge from the LH vehicles you control. Take it from
  > any of them, in any zone — you choose how much each gives up as you play
  > it. You need N in total across your board, so losing charged vehicles can
  > put this card out of reach.

  The Discharge rows keep "one vehicle holds the whole cost". The two now
  differ in one word each way, and the copy says so plainly.

## 5. PracticeAI

- The bot sends no `chargeFrom`, so it always pays the suggested split. The
  evaluator already prices pips (`EVALUATOR.charge`), so its trial plays see
  the cost. No move-menu change.
- `rulesPrimer.ts`: "Drain N Charge" means the card can be played only while
  your whole board holds N pips, and playing it spends them.
- The LH line in `factionNotes.ts` and the comment in `botDecks.ts` follow the
  new name. PracticeAI's LH deck carries no Drain card, so its play is
  unchanged.

## 6. Data

| Card | Gate was | Gate now | Printed text |
|---|---|---|---|
| Dynamo | 2 | 1 | Drain 1 Charge. |
| Quadrupole | 3 | 2 | Drain 2 Charge. |
| Cathode | 3 | 2 | Drain 2 Charge. Discharge 2: … (unchanged) |
| Terawatt | 3 | 2 | Drain 2 Charge. Generators: … Discharge 2: … (unchanged) |
| Candela | 4 | 3 | Drain 3 Charge. |
| Impedance | 5 | 4 | Drain 4 Charge. Discharge 2: … (unchanged) |

Costs, ⚡ maxes, rates and every other key are unchanged.
`lh.balance.test.ts` pins the new values, and `seed:build` regenerates
`seed_data.sql`. **Card data does not deploy with the code** (CLAUDE.md):
`seed-apply.yml` applies it on merge, so check that run, and
`npm run seed:verify` must then report drift 0.

Games in progress keep their dealt snapshots, with the old gates and the old
card text, but play by the new rule once the functions deploy. The hand
banner and the card-details row read the gate from the snapshot, so a card
dealt before the deploy shows "Drain 3 Charge" beside printed text that says
"Requires 3 Charge". Accepted.

## 7. Balance evidence

A throwaway self-play probe, in the scratchpad and not repo code, used the
scored policy on both seats, both seat orders per seed, and the
strength-based battle resolver. It played an LH deck carrying Drain cards
against PracticeAI's own LH deck, which carries none and so is untouched by
every variant. Each cell is 250 games, about ±6 points at 95 %.

| LH deck | Checked, never spent (live) | Spent, numbers unchanged | **Spent, every gate −1 (chosen)** | Spent, 3-gates → 2 only |
|---|---|---|---|---|
| Capitals: all six Drain hulls | 61 % | 59 % | **69 %** | 67 % |
| Mid-range: Dynamo and the three 3-gates | 70 % | 64 % | **70 %** | 67 % |

Spending alone cost a Drain deck 2–6 points. Every gate −1 restores the
mid-range deck exactly and leaves the capitals deck about 8 points above
today; the owner chose that offset. The scored bot pays the suggested split
and plays charge crudely, so human play may differ; the playtest (§8)
samples that.

Side finding, not caused by this change: in the same harness LH loses 90–100 %
of its games to DWG and SS under every variant. PracticeAI's own LH deck wins
3 % against DWG, 1 % against SS and 5 % against WF. It is out of scope here and
belongs in a separate task.

## 8. Testing and verification

- **TDD** (card-effects.md). Failing engine tests come first:
  - the play spends the chosen split;
  - an absent field pays the suggested split, covering battery order, timer
    order and ties;
  - every refusal in §3;
  - the forced test and the log line;
  - Excalibur's path is gated;
  - paying leaves `activatedOnTurn` alone;
  - a second Drain card in the same turn needs its own pips.

  Then the helpers' unit tests, the copy tests (`keywords.test.ts`), and the
  primer and faction note.
- **Gates**, each run in full:
  - `npx vitest run --maxWorkers=4`, with the before → after count;
  - `npx tsc -p tsconfig.json --noEmit`;
  - `npm --prefix frontend run build` and `npm --prefix frontend run lint`;
  - `npm run functions:sync`, with its output committed, then
    `npm run functions:check`;
  - `npm run seed:build`, with `seedDataSync` green.
- **Playtest, pre-merge and headless.**
  - A throwaway referee in the scratchpad runs the new engine in-process.
    Each side has its own CLI view: its hand, the public board, a numbered
    list of legal moves from the engine, and any pending choice. A Drain play
    may carry the player's own split.
  - Battles are reported by the strength resolver, as in the eval harness.
  - Two subagents, one per seat, share no context and never read the other
    side's view. Each plays to the end and writes a short note: how often Drain
    held them back, whether paying hurt, whether the split mattered, and
    anything that felt broken.
  - Games: LH, with the capitals deck, against DWG and against SS, seats
    swapped. One referee process, idle between moves.
- **Browser, post-deploy**, signed in through `scripts/qa-login.mjs`:
  - a Drain card in hand shows the banner when short;
  - with two charged hulls the dialog opens pre-filled, and a changed split is
    what drains;
  - a forced split skips the dialog;
  - the log line reads right, and so does the card-details row.
- **Post-merge.**
  - The seed-apply run is green, and `seed:verify` reports drift 0.
  - `game-action` and `lobby-action` versions have incremented, read back
    **by content** (`suggestedChargeSplit`).
  - The Netlify `PhysicalCard-*.js` chunk carries "Drain".

## 9. Edits to the 2026-09-21 LH spec

§1's "Two verbs" and "Pricing" rows; §3.3, replaced by a summary that points
here; R-14; R-20 and R-23 where they cite gate numbers; the §5 roster text for
the six cards; §5.5's charge-timeline sentence; and §8's chokepoints and
helpers.

## 10. Out of scope

- LH's bot-play results against DWG and SS (§7).
- A `chargeFrom` field on Excalibur's path.
- Renaming the `requiresCharge` key.
- Any change to Discharge.
