# 2026-09-22 LH: card draw — design

Amends the [2026-09-21 LH faction redesign](2026-09-21-lh-faction-redesign-design.md)
(and sits beside the same day's [Drain N Charge amendment](2026-09-22-lh-drain-charge-design.md)).
Decisions taken with the owner on 2026-09-22; where this document and the
2026-09-21 spec disagree, this one wins. Overturns **R-1** ("Byte draws on
discharge, not on play").

## 1. Why

The owner: LH does not have enough draw to keep momentum against the other
factions. Measured the same day:

- **Pool.** LH had one draw card (Byte, slow by R-1). DWG has 8, OW 12, SS 6,
  WF 6, TG 4. The redesign had retired LH's older draw (Coulomb, Sapphire,
  Spectrum, Robotic Assemblers).
- **Play** (bot vs bot, scored evaluator both seats, strength resolver, 150-game
  round robin): LH's hand at the start of its turn fell from 6.6 (T2) to 2.4
  (T10) while DWG/OW/SS/WF climbed to 9–12; LH drew 1.5 cards a game beyond the
  turn draw against 8–15, and left 46 % of its materials unspent.

## 2. Decisions

| Decision | Choice |
|---|---|
| Shape | A **mix**: draw-on-play for the floor (the hand refills even after the board is raced) plus a way to turn charge into cards. |
| Amount | **SS/WF level**: about six draw cards in a typical twenty-card LH deck, roughly eight extra cards a game. |
| Source | **Both**: new cards plus a small change to an existing one. |
| Package | **A** (Faraday) over B (Tesla, 716k, "draw 2 when played"): Tesla sat in hand until about turn 9 in the probe, and the hand shrinks from turn 3. |
| Testing | The owner asked for the change without further probes or playtests; it is tested live. |

## 3. The cards

| Card | Type · cost (FtD) | ⚡ | Keywords | Text | Registry id |
|---|---|---|---|---|---|
| Byte (changed) | ship · 40k (43k) | 1 | Mobile | When played, this gains 1 charge. Discharge 1: draw a card. | `byteChargeOnPlay` (new) + `byteDraw` |
| Faraday (new) | airship · 140k (142k) | 2 | Mobile | When played, draw a card. | `faradayOnPlay` |
| Data Burst (new) | ability · 50k | — | — | Discharge 2 from a friendly LH vehicle: draw 2 cards. | `dataBurstEffect` |

- **Byte**: the pip it enters with is an ordinary pip — discharge it for the
  draw the turn it lands, or keep it to pay a Drain. Snapshots dealt before the
  deploy name no `onPlayEffect` and keep entering empty.
- **Faraday** is the report's radar-heavy plasma hover-boat (141,825), an airship
  by R-5, Mobile like the other raiders. Its ship profile is imported from the
  report. It is the pool's seventh flier card; the six-copy deck limit is
  unchanged.
- **Data Burst** uses the existing Discharge-from path (§3.2 of the redesign):
  the engine validates the host, spends two pips and stamps the host's
  activation (R-20); the effect only draws. Discharge 2 was chosen over
  Discharge 1, which overshot to DWG-level draw in the probe (§5).
- Constants: `BYTE_PLAY_CHARGE`, `DATA_BURST_DRAW` in `shared/gameSettings.ts`.

## 4. PracticeAI

- **Evaluator** `EVALUATOR.charge` 0.15 → **0.04**. At 0.15 a pip outweighed a
  card (`hand` 0.10), so the bot never discharged Byte; at 0.05 Data Burst's
  trade scored exactly zero and lost to END TURN.
- **Deck** (`BOT_DECKS.LH`): Faraday ×2 and Data Burst ×2 in; both Watts,
  Megawatt and the second Kilowatt out (none is named in the strategy notes).
- **Strategy notes** (`factionNotes.ts`): one bullet on the draw cards.

## 5. Probe evidence (throwaway, not in the repo)

LH against each of the five other bot decks, 50 games per row, same seeds, charge
weight lowered so the bot trades pips for cards:

| LH version | Extra cards / game | Hand at T10 | LH wins |
|---|---|---|---|
| Before | 3.2 | 3.3 | 8 % |
| Package A (as shipped, Discharge 2) | 8.9 | 6.4 | 28 % |
| Package A with Data Burst at Discharge 1 | 16.3 | 7.6 | 50 % |
| Package B (Tesla) | 7.2 | 7.1 | 24 % |

The probe's LH deck differed slightly from the shipped bot deck (it kept one
Watt, Megawatt and both Kilowatts and cut the other Watt, Dipole, Eclipse and
Hydrovolt), and at charge
weight 0.05 the bot almost never cast Data Burst — so the shipped bot will draw
more than the A row. Bot games, a strength resolver that ignores stun: numbers
for direction, not balance.

## 6. Still open

- Live test (owner): the three cards in play, the Data Burst host pick in the
  browser, and the draw rate against real opponents.
- TG's hand also shrinks in bot play, but its pool has four draw cards and its
  bot deck plays one — a deck-curation question, not a pool one.
