# 2026-09-23 LH: Drain becomes a discount; Cathode, Watt and Quadrupole rebalanced — design

Amends the [2026-09-22 Drain N Charge design](2026-09-22-lh-drain-charge-design.md),
the [2026-09-21 LH faction redesign](2026-09-21-lh-faction-redesign-design.md)
and the [2026-09-22 hovercraft amendment](2026-09-22-lh-hovercraft-design.md).
Every ruling below was taken with the owner on 2026-09-23 and binds the change
that implements it. Where this document and an older one disagree, this one
wins. The older ones are edited to point here (§11).

## 1. Decisions

| Decision | Choice |
|---|---|
| Drain | **A discount, never a blocker.** A Drain card can always be played at its printed price. Draining N pips as you play it takes N × 50k off. |
| Shape | **All or nothing.** Drain exactly N pips, split any way you like as today, or drain none. There is no partial drain. |
| Rate | **50k per pip**, from one constant, `DRAIN_DISCOUNT_PER_CHARGE`. |
| Prices | **Printed prices rise by N × 50k**, so a drained play costs exactly what the card costs today. Cathode is the one exception (below). |
| Card value | **Value follows price** (owner ruling after the whole-branch review). The printed price is also the hull's value everywhere else: bombard damage is cost ÷ 1000, FtD battle materials are 10% of cost, repairs cost 50%, and Boarding Party needs a ship that costs at least as much. So the repriced hulls hit harder, cost more to repair, and are harder to steal (§8). Chosen over keeping today's prices, and over a surcharge that would have left their value unchanged. |
| Data key | **`meta.requiresCharge` is kept and changes meaning** (approach A). There is one rule in the code. Games in progress keep their dealt prices (§9). |
| Cathode | Stays at **600k**, so 500k drained. Its only keyword is **Fragile**: Stealthy and Sub Screen are gone. **No Discharge ability.** It gains **Overheat**: after each battle it fights, it is stunned until the end of the next turn, using the existing stun unchanged. |
| Watt | **120k.** It **enters with no charge**: when played it only spawns its Luxon. |
| Quadrupole | **Loses Mobile.** Blocker only, and still Fragile, as every airship is. |

Why Cathode needed more than a price: in FtD it is a submerged heavy torpedo
submarine, rated 5/5 against ships with 5/5 toughness, and only torpedoes
reach it. Across every faction's ship profiles, 13 craft rate even 3/5 against
submarines and none rates 5. DWG has one (Loggerhead), and OW and TG have no
profiles yet. The card answers are WF Sub Strike, WF Judgement and OW Sub
Killer. Its own Sub Screen shut out the enemy submarines that could fight it.
Submarines never bombard (design spec §3.4), so its whole threat was fleet
fights: it could empty its lane every turn and win every defence there.
Stealthy and Fragile alone change little against a hull nothing can damage.
The fix therefore reopens its lane to enemy submarines (no Sub Screen) and
makes every fight cost it a turn (Overheat).

## 2. The Drain rule (replaces the 2026-09-22 spec §2)

`meta.requiresCharge: N` is printed **"Drain N Charge: costs Xk less."**, where
X = N × 50k.

1. **Two ways to play.** As you play the card, either
   - **drain**: spend exactly N pips from your LH hulls, split across any
     number of them in any lanes, and pay the price less X; or
   - **pay full price**: spend no charge and pay the price.
2. **Never a blocker.** With fewer than N pips on your board, only the full
   price is on offer. There is no shortfall refusal any more.
3. **The price** is `max(0, effectiveCostInGame − X)` when drained, and
   `effectiveCostInGame` otherwise. The discount comes off last, after cost
   modifiers, stored `costDelta` and Half-Cost, so the card costs exactly X less
   than it would otherwise.
4. **Unchanged from 2026-09-22:**
   - "LH" is `faction === 'LH'`.
   - Stealthy and stunned hulls may pay.
   - The card being played never pays.
   - Paying is not an activation.
   - The drain is read and paid at play time only; spawns and captures ignore it.
   - The suggested split (§2.1 there) and the forced split (§2.2 there).
5. **Log** (public): `Quadrupole drains 2 charge for 100k off — Chrysoprase 1, Kilowatt 1`.
   A full-price play logs no drain line. The "for 100k off" answers the
   playtest finding that a drain line read like an ability's effect.

## 3. Engine

- **Constant.** `DRAIN_DISCOUNT_PER_CHARGE = 50_000` in `shared/gameSettings.ts`.
- **`drainDiscountOf(card)`** in `charge.ts`: `chargeGateOf(card) × DRAIN_DISCOUNT_PER_CHARGE`.
- **`planDrain(state, side, card, chargeFrom)`** returns `{ split, discount }`
  or `{ error }`:

  | `chargeFrom` | Card without a Drain | Card with Drain N |
  |---|---|---|
  | absent | no split, no discount | the suggested split and the discount **if the board holds N**; otherwise no split, no discount |
  | `[]` | no split, no discount | **full price**: no split, no discount |
  | non-empty list | 400 `<Card> drains no charge` | validated by `chargeSplitError` exactly as today (total exactly N; each hull the player's LH, holding enough, listed once) → split and discount |
  | anything else | 400 | 400 `chargeFrom must be a list of { instanceId, amount }` |

  The absent row is PracticeAI's path, and a forced split's. It is today's
  behaviour whenever the board can pay, and a full-price play when it cannot.
- **Both deploy handlers**, `PLAY_CARD_TO_ZONE` and
  `PLAY_CARD_TARGETING_CARD_IN_HAND` (Excalibur's path, no `chargeFrom`, so
  the absent row applies), in this order:
  1. `planDrain`;
  2. the affordability check against the price of the chosen mode;
  3. the other legality checks, as today;
  4. take from hand;
  5. pay the chosen price;
  6. `applyDrain(game, side, cardName, split, discount)`, which logs;
  7. deploy.

  Nothing is spent on a refusal (the handler works on a clone).
- **`chargeGateShortfall` retires.** Its readers were the shortfall refusal and
  the hand banner, and both are gone.
- **Two pure helpers beside `effectiveCostInGame`** in `placement.ts`, exported
  through `engine/index.ts`. The hand, the board and the dialog import them,
  never mirror them (frontend.md):
  - `cheapestCostInGame(state, side, card, turnNumber)`: the drained price when
    the board holds N, otherwise `effectiveCostInGame`.
  - `drainNeedsChoice(state, side, card, turnNumber)` moves here from
    `charge.ts`, because it now needs prices. It is true when a drained play
    is affordable **and** either the full price is also affordable or the
    split is not forced. Materials and CP both count.

## 4. Frontend

- **`DrainChargeDialog`**:
  - The title is "Drain 2 charge for Quadrupole?", with one line: "Drain
    exactly 2 charge from your LH vehicles and it costs 100k less, or pay the
    full price and keep your charge."
  - The payer rows, steppers and "2 of 2 chosen" counter are as today, and it
    opens on the suggested split.
  - It has three actions:
    - **Drain and pay 560k** is enabled when the total is exactly N and that
      price is affordable. It sends the split.
    - **Pay full price — 660k** is enabled when that price is affordable. It
      sends `chargeFrom: []`.
    - **Cancel**, along with Escape and the backdrop, leaves the card in hand.
- **Flow.** `playToZone` in GameBoardPage opens the dialog when
  `drainNeedsChoice` is true on your turn. Otherwise it sends the play at once
  with no `chargeFrom`: the engine drains when the board can pay, or charges
  full price. An unaffordable play still sends, and the server's refusal shows
  inline as today.
- **Hand** (HandBar):
  - The "Drain N Charge — you have M" banner goes.
  - A card's price pill, affordability ring and Play button label use
    `cheapestCostInGame`. A Drain card the board can pay therefore shows the
    printed price struck through beside the drained price, and it turns red
    only when neither price is affordable.
  - GameBoardPage's lifted-card materials tint uses the same helper.
- **Copy.**
  - The card-details row in `keywords.ts`, still labelled "Drain N Charge":
    > As you play this, you may drain exactly N charge from the LH vehicles you
    > control — any mix of them, in any zone. If you do, it costs Xk less.
    > Drain nothing and you pay the full price, so it is never out of reach.
  - The `PhysicalCard` chip keeps "Drain N Charge". Its tooltip becomes: "You
    may drain N charge from your LH vehicles as you play this — any mix of
    them, across your board — to pay Xk less."
- **Stun badge.** `MiniVehicle`'s tooltip says "until the end of its owner's
  next turn", which is wrong for a Cathode that overheats after attacking. It
  now reads the stamp: "until the end of this turn" when the stun clears at the
  next turn's start, otherwise "until the end of the next turn".

## 5. PracticeAI

- The bot sends no `chargeFrom`, so it drains whenever its board holds N, and
  otherwise pays full price. Its trial plays see the price it actually pays.
  No move-menu change.
- `rulesPrimer.ts`, the Drain sentence: "Drain N Charge: costs Xk less" means
  that as you play the card you may spend exactly N pips from your LH hulls, in
  any mix, to pay Xk less; with fewer you pay the full printed price. The game
  drains for you whenever your board holds N, taking first from hulls without a
  Discharge of their own.
- `factionNotes.ts`:
  - The Drain bullet: a Drain capital costs 50k less per pip when your board
    holds its N as you play it, and full price otherwise. Keep the pickets
    alive to bank pips.
  - The Watt bullet: its pip arrives at the start of your next turn; discharge
    it for a card each turn it lives.
- `botDecks.ts`: the LH deck is unchanged, and still carries no Drain capital.
  Its comment ("a greedy bot would hold them all game") is reworded, since
  they no longer block.

## 6. Cathode — Overheat

- **Text:** "Drain 2 Charge: costs 100k less. Overheat: after each battle it
  fights, it is stunned until the end of the next turn."
- **`cathodeOverheat`**, a new id, runs on `onBattleEffect`:
  - It acts only when a battle resolves (`battle.phase === 'resolve'`) and
    Cathode survived (`battle.survived`), whatever the outcome, draws included.
    At lock it does nothing.
  - It finds the live hull by `instanceId` (`findVehicle`, as Braveheart does).
  - It stamps the existing stun: `stunnedUntilTurn` = the battle's turn +
    `STUN_DURATION_TURNS`, rounded as `stunHull` rounds.
  - Its log line is "Cathode overheats — stunned until the end of the next
    turn", not `stunHull`'s "…its owner's next turn".
- **Every battle it fights counts:** fleet battles attacking or defending, and
  forced 1v1s such as WF Judgement's.
- **What that means in play:**
  - After Cathode attacks on your turn, it is stunned through the enemy's
    turn. It is held still in FtD and cannot dodge.
  - After it defends on the enemy's turn, it is stunned through your next
    turn, so it cannot strike back.
  - Stun is otherwise unchanged (2026-09-21 spec §3.4). It still defends and
    may still pay drains.
- **FtD.** `holdsStillInFtd` already covers submarines. A battle file built
  while Cathode is stunned flags it `Stunned`, and the spawn sheet marks it
  "held still". Whether a held-still submarine stays at the surface, where
  submarines spawn (`SpawnAltitude` 0), is **unverified**: it is the owner's
  FtD test.
- **Charge.** It keeps ⚡2 but has no Discharge, so its pips can pay for other
  drains. The suggested split takes from it first, as a battery.
- **`cathodeDuel` stays registered** for dealt snapshots. It goes in G4's
  `DELIBERATE_ORPHANS` with that reason.

## 7. Watt and Quadrupole

- **Watt:**
  - A new id, **`wattEscortOnPlay`** (`needsCatalog`), spawns the Luxon escort
    exactly as `wattOnPlay` does: Decoy, not Temporary, instance `summonOnly`.
    It adds no pip, so the Watt's first draw comes after its owner's next turn
    starts.
  - `wattOnPlay` and `WATT_PLAY_CHARGE` stay, for dealt snapshots. The id goes
    in `DELIBERATE_ORPHANS`.
  - Text: "When played, a friendly Luxon spawns in this zone. That Luxon has
    Decoy and is not Temporary. Discharge 1: draw a card."
- **Quadrupole:** keywords `[Blocker]`, and the price from §8.

## 8. Data

Printed price (drained price in brackets), with FtD blueprint cost for
reference:

| Card | Type | Was | Now | Blueprint | Keywords now | Printed text now |
|---|---|---|---|---|---|---|
| Dynamo | airship | 350k | **400k** (350k) | 346k | Mobile, Swift | Drain 1 Charge: costs 50k less. |
| Thyristor | airship | 400k | **500k** (400k) | 565k | Mobile | Drain 2 Charge: costs 100k less. |
| Quadrupole | airship | 560k | **660k** (560k) | 685k | **Blocker** | Drain 2 Charge: costs 100k less. |
| Terawatt | hover | 640k | **740k** (640k) | 725k | Blocker, Scrappy, Mobile | Drain 2 Charge: costs 100k less. Generators: … Discharge 2: … (rest unchanged) |
| Candela | ship | 700k | **850k** (700k) | 1,021k | Blocker, Sub Screen, Scrappy, Mobile | Drain 3 Charge: costs 150k less. |
| Impedance | ship | 750k | **950k** (750k) | 1,327k | Blocker | Drain 4 Charge: costs 200k less. Discharge 2: … (rest unchanged) |
| Cathode | sub | 600k | 600k (**500k**) | 726k | **Fragile** | Drain 2 Charge: costs 100k less. Overheat: after each battle it fights, it is stunned until the end of the next turn. |
| Watt | hover | 90k | **120k** | 91k | Scrappy, Mobile | When played, a friendly Luxon spawns in this zone. That Luxon has Decoy and is not Temporary. Discharge 1: draw a card. |

- **Meta changes:**
  - Cathode: `{ chargeMax: 2, requiresCharge: 2, onBattleEffect: 'cathodeOverheat' }`.
    Its `onActivate`, `activateCpCost` and `dischargeCost` go.
  - Watt: its `onPlayEffect` becomes `wattEscortOnPlay`.
  - No other key changes.
- **Value follows price (§1).** The new printed prices also set each hull's
  value, so bombard damage per hull changes:

  | Card | Damage |
  |---|---|
  | Dynamo | 350 → 400 |
  | Thyristor | 400 → 500 |
  | Quadrupole | 560 → 660 |
  | Terawatt | 640 → 740 |
  | Candela | 700 → 850 |
  | Impedance | 750 → 950 |
  | Watt | 90 → 120 |

  Against a 2,000 HP base this moves some kill thresholds. Terawatt alone now
  needs three bombards rather than four. Impedance kills with two bombards and
  its beam, where it needed three before.
- **Pins.** `lh.balance.test.ts` pins every row above, including each Drain
  card's text against its gate, so "costs Xk less" always equals N × 50k.
- **Deploy.** `seed:build` regenerates `seed_data.sql`, and card data does not
  deploy with the code (CLAUDE.md): `seed-apply.yml` applies it on merge.

## 9. Games in progress

Dealt games hold frozen card snapshots and play by whatever code is deployed
(approach A, accepted by the owner):

- Their Drain cards keep their old prices and text. From the deploy on, they
  can be played without charge at that price, or drained for N × 50k less, so
  they are cheaper than intended until those games end. PR #83 accepted the
  same drift.
- Their Cathode keeps Stealthy, Sub Screen and its duel, and has no Overheat.
- Their Watt still gains its pip. Their Quadrupole keeps Mobile.

## 10. Testing and verification

- **TDD** (card-effects.md). The failing engine tests come first:
  - A drained play spends the split and pays the price less X. A full-price
    play (`[]`) spends nothing and pays the full price.
  - Absent `chargeFrom`: it drains the suggested split when the board holds N,
    and pays full price when the board holds fewer.
  - A card affordable only when drained plays drained. `[]` on it refuses as
    unaffordable. A card affordable in neither mode refuses.
  - Every split refusal still refuses. A non-empty split on a card without a
    Drain refuses.
  - The log line.
  - Excalibur's path follows the absent row.
  - Paying still leaves `activatedOnTurn` alone.
  - `cheapestCostInGame` and `drainNeedsChoice`, across the affordability and
    forced cases.
  - Overheat: Cathode survives an attack, a defence and a forced 1v1 and is
    stunned to the battle's turn + 1. A Cathode that dies is not touched.
    Nothing happens at lock. The log line.
  - A stunned Cathode is `holdsStillInFtd`.
  - `wattEscortOnPlay` spawns the Luxon and adds no pip. The old `wattOnPlay`
    still adds its pip.
  - Then the balance pins, the G4 orphan entries, the copy tests
    (`keywords.test.ts`, the chip, the stun badge), the dialog, and the
    primer and faction-note tests.
- **Gates**, each run in full:
  - `npx vitest run`, reporting the before → after count;
  - `npx tsc -p tsconfig.json --noEmit`;
  - `npm --prefix frontend run build` and `npm --prefix frontend run lint`;
  - `npm run functions:sync`, with its output committed, then
    `npm run functions:check`;
  - `npm run seed:build`, with `seedDataSync` green.
- **Browser, after merge** (the backend is remote-only, so the new rows exist
  only after the seed job). Sign in through `scripts/qa-login.mjs`, then check:
  - a Drain card's hand pill;
  - the dialog's two actions, and that each one charges what it says;
  - a full-price play with an empty board;
  - the log line;
  - the new card copy.
- **After merge:**
  - the `seed-apply.yml` run is green, and `npm run seed:verify` reports drift 0;
  - `game-action` and `lobby-action` versions have incremented, checked by
    content (`cathodeOverheat`, `wattEscortOnPlay`, `DRAIN_DISCOUNT_PER_CHARGE`
    and the drain log's "charge for" template);
  - the Netlify `PhysicalCard-*.js` chunk carries the new ids and copy;
  - **the owner's FtD test**: a stunned Cathode held still, surfaced or not.

## 11. Edits to older specs and docs

- **2026-09-22 Drain spec:** a note at the top saying that its precondition,
  shortfall refusal and "exactly N or refused" are superseded here. The split
  rules (§2.1–§2.2) and the dialog's payer rows stand.
- **2026-09-21 LH spec:** §5's roster rows and curve line for the eight cards,
  R-18 (Cathode no longer duels or surfaces), and a pointer at §3.3's summary.
- **2026-09-22 hovercraft spec:** a pointer on the Watt row.
- **`docs/claude/card-effects.md`:** the `summonOnly` token example names
  `wattEscortOnPlay`.

## 12. Out of scope

- PracticeAI's LH deck curation. Drain capitals no longer block, so they could
  join it later.
- The heuristic fallback's `canAfford`, which reads printed prices.
- `describe.ts` cost labels ignoring in-game discounts, an open follow-up from
  PR #83.
- Renaming `requiresCharge`.
- Making a held-still submarine surface. That would be mod work in FtdReal, not
  here.
