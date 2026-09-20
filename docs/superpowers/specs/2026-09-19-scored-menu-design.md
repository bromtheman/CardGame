# 2026-09-19 Scored menu — design

Gives PracticeAI a **compass**: a one-ply position evaluator that scores every
verified menu move in **turns of tempo**, shows the model those numbers, and
refuses a move that throws away more tempo than a setting allows. The same
evaluator plays on its own as a third flow (`BOT_FLOW=scored`) and replaces
the heuristic as the fallback whenever the model cannot answer.

The [2026-09-18 sectioned bot turn spec](2026-09-18-sectioned-bot-turn-design.md)
and the [2026-09-16 LLM PracticeAI spec](2026-09-16-llm-practice-ai-design.md)
stay binding for everything this document does not name: the `BotPolicy`
seam, the menu's enumeration and verification, the conversation, hidden
information, table talk, telemetry's purpose, the fallback ladder. Read
[docs/claude/architecture.md](../../claude/architecture.md) before touching
the driver or the menu.

Written while the owner was away, with standing authority to keep working
without check-ins; every choice below that would normally have been a
question is recorded under §1 and §11 so it can be reversed on review.

## 1. Decisions

| Decision | Choice |
|---|---|
| Why now | The 2026-09-19 eval rebuild (strength-based battles, mirror pairing — `af355a7`) showed the model-backed flows barely beat `basicPolicy`, and a $0 experiment showed why the bar is low and how to raise it: a **one-ply tempo evaluator** playing alone beats the heuristic **110–10 (92 %)** over 120 mirror games on every deck (DWG 34–6, SS 37–3, WF 39–1), at ~50 ms of compute per turn. Under this engine a game is a two-base bombardment race; the evaluator measures exactly that, and the model never had the number. |
| What the model sees | Every turn-menu line carries its **tempo delta**: turns of tempo gained over doing nothing more (`[+2.4]`), END TURN at `[0.0]`, a losing fleet attack negative. The primer explains the number and its limits. |
| What the model may not do | The **tempo guard**: a move (or a pass, or END TURN) worth `TEMPO_GUARD_TURNS` or more below the best available move is not accepted — the best move is played instead, and the row records it. The model keeps every choice inside that margin, its notes and its table talk. |
| Who else uses the evaluator | `ScoredPolicy`: picks the best-scored move, no model. It is the third flow (`BOT_FLOW=scored`), the **fallback** inside both model flows (a failed call now plays the evaluator's move, not the heuristic's), and what plays when no key is set. `basicPolicy` stays the eval's opponent and the last-resort fallback. |
| Pruning | Optional: `MENU_SCORE_WINDOW_TURNS` hides moves further below the best than the window (END TURN always stays); `Infinity` turns it off. Measured by the eval (§10): the matrix chose a window of **2** (§13). |
| Where scoring runs | In `buildMenu`, beside the trial application it already does — the driver's side of the hidden-information boundary, like the annotations. Policies only read `MenuItem.score`. |
| Opponent for the eval | Unchanged (`basicPolicy`) so numbers stay comparable; `--opponent scored` raises the bar when wanted. |

## 2. Goals and non-goals

Goals:

- **A.** The model-backed flows win materially more mirror games against
  `basicPolicy` than today (§10 sets the numbers), at Mercury's default
  effort, without a latency regression the human would notice.
- **B.** A key-less or model-failed bot plays the evaluator, not the heuristic.
- **C.** Every number is a setting; the guard and the window can be switched
  off (`Infinity`) to recover today's behaviour for a comparison.

Non-goals: search deeper than one move (a greedy rollout is a follow-up,
§12); scoring the response/decision/choice kinds (the heuristic's order
stands); changing what the human sees; changing `basicPolicy`.

## 3. The evaluator — `shared/ai/evaluator.ts`

Pure functions over an `EngineGame`; no policy, no model, no I/O.

### 3.1 Strike power

`strikePower(hulls)`: the sum over the hulls of `floor(effective material
cost / BASE_DAMAGE_DIVISOR)`, skipping submarines, Inoffensive hulls, hulls
with `meta.noBaseDamage`, and **Temporary** hulls (removed at the next turn
start, so they never strike). It deliberately counts hulls played this turn:
the score is read at the start of the enemy's turn, and they strike on ours.

### 3.2 Turns to win

`turnsToWin(game, attacker)`: per zone, the turns the attacker needs to fell
the defender's base at current power — `0` if it has already fallen,
`EVALUATOR.capTurns` (60) if a defender hull there has Blocker or the
attacker has no strike power there, else `baseHp / strikePower`, clamped
at the cap (a bombardment slower than the cap counts like a stalled zone).
Bombardment runs in every zone in parallel and the game ends when the
second base falls, but the answer is the **sum of the two smallest** zone
times, not the second smallest alone. The second smallest hid all progress
against the first zone: a striker in one zone moved nothing until a second
zone was threatened, so single-zone progress never registered in the score.
The sum keeps it visible (Task 3 ruling; self-play against the heuristic:
109–11 as the sum against the §1 experiment's 110–10 as the second smallest
— equivalent strength, and a score that moves).

### 3.3 Position score

`positionScore(game, side)`, in turns:

```
turnsToWin(game, enemy) − turnsToWin(game, side)
+ EVALUATOR.board  × (own board cost − enemy board cost) / income     (0.4)
+ EVALUATOR.hand   × own hand size                                   (0.1)
+ EVALUATOR.baseHp × (Σ own base HP − Σ enemy base HP)               (0.0005)
```

`income` is `MATERIALS_PER_TURN × floor(turn number)` (at least one turn's
worth). A decided game scores `±EVALUATOR.win` (1000). The board term values
hulls for the fights and bombardments to come; the hand term values cards;
the base-HP term breaks ties toward damage that the two-base measure cannot
yet see. The weights are the ones the 92 % experiment used; §10 keeps them
unless an eval says otherwise.

### 3.4 Scoring a move

`scoreMove(game, botId, action, ctx, seed)` returns the position score at
the **start of the enemy's turn** if the bot made this move and then ended
its turn, or `null` when the move cannot be trial-applied:

1. Trial-apply the move with a seeded rng (`mulberry32(seed)` — the menu's
   trial context, so scoring is deterministic per menu build).
2. If the bot now owes a **choice** (an effect asking), take the first
   accepted option from `basicPolicy` (at most four times).
3. **A battle**: the trial leaves a battle open — a fleet attack's response
   window or lock, or one an effect forced (Martyr Attack, an interception).
   Play it out `EVALUATOR.battleSamples` (6) times, each with its own rng:
   the defender withdraws nothing (when it has a window at all), the
   defender submits the report `resolveBattle` (battleSim.ts) draws, the bot
   approves it repairing nothing, any pending choice on either side takes
   its first option; end the turn; score. The move's score is the **mean**
   of the samples that completed (`null` if none did). `resolveBattle` is
   **shipped code** — the same resolver the eval uses, inside both
   functions — and its loss law is the **square law** `r² / (1 + r²)`
   (Lanchester-like: the share of a side's hulls focused, for `r` = enemy
   offense over own defense; a half in an even fight, nine tenths when
   outgunned three to one). The linear law `r / (1 + r)` it replaced made
   every fight zero-sum in expected cost — both sides lost `M·E/(M+E)` for
   any mismatch — so no evaluator could prefer fighting when stronger.
4. Otherwise apply END TURN and score the result. END TURN itself scores its
   own trial state.

Death triggers, Scrappy, Fragile, base-attack victories, everything the
engine does on those paths, fire for real in the trial — the evaluator
never re-implements a rule.

### 3.5 Delta

`MenuItem.score` is stored as the **delta** against the END TURN item's
score (`0` for END TURN), rounded when shown to one decimal. Higher is
better; only differences between lines mean anything.

## 4. Menu changes — `moveMenu.ts`

- `MenuItem` gains `score: number | null` — the tempo delta for turn kinds,
  `null` for the other kinds (unscored, §2).
- `buildMenu` scores every kept turn item after the existing trial loop,
  reusing its trial context's seed stream so a build is deterministic. An
  item whose scoring fails keeps `null` and stays offered (the guard and the
  sort treat `null` as `0`).
- The END TURN fallback item is scored like any other, so it always carries
  `0`.
- Cost: one END TURN trial per item plus the battle samples — bounded by
  `MENU_MAX_TRIALS` as today; ~25 items and two fleet attacks is on the
  order of a hundred extra `applyAction` clones, tens of milliseconds.

## 5. `ScoredPolicy` — `shared/ai/scoredPolicy.ts`

`needsMenu: true`. For a turn: the items with a **strictly positive** delta
first, score descending with ties in menu order; then **END TURN**; then
every item at or below it (a zero or null delta), in menu order — still
offered in case END TURN is refused, but END TURN precedes them all. Only a
move worth more than ending ranks above ending: an earlier "END TURN loses
every tie" rule looped on `SET_ALERT_CARD`, which is legal as long as an
ability card is in hand (a re-reveal replaces the last one) and worth
exactly 0 (the alert expires with the turn), so the driver revealed it until
`BOT_ACTION_CAP`, sixty menus and as many public log lines per request
(final-review ruling; the cost is that a free zero-delta deploy is never
made by this flow, which the one-ply evaluator could not value anyway). For
the other kinds: `basicPolicy`'s candidates. `onAccepted` returns `null`
(no table talk). Exported as `scoredPolicy` (stateless, like `basicPolicy`).

## 6. The model flows

### 6.1 What the model reads

`buildUserPrompt` and `numberedMenu` render a turn item as
`#3 [+2.4] Deploy Corsair to zone 1 — …`; other kinds render as today. The
primer's HOW YOU PLAY block (both flows) gains:

> Each turn move starts with its tempo estimate in brackets: the turns the
> human needs to fell your second base minus the turns you need for theirs,
> after that move, compared with ending your turn now. Higher is better and
> only the differences matter. It counts bombardment and hulls on the board
> and plays a fleet battle out by cost; it does not see what an ability does
> later or how well the human fights, so treat it as a compass, not an order.
> A move worth at least {{TEMPO_GUARD_TURNS}} turn(s) of tempo less than the
> best move is not accepted — the best move is played instead.

The digits stay in placeholders (rulesPrimer.test.ts's no-digit rule). The
guard sentence is rendered from the margin **the policy runs with** — its
settings' `tempoGuardTurns`, passed through `buildSystemPrompt(faction,
flow, guardTurns)` to `renderPrimer` — and is left out entirely when that
margin is not finite, so an advisory run (`--guard inf`) never tells the
model a guard exists (final-review ruling).

### 6.2 The tempo guard

In both policies, at the one place each turns a chosen menu item into the
action it returns (`LlmPolicy.candidates` for the plan head,
`SectionedLlmPolicy.turnMove` for a proposed move, a pass, and END TURN):

- `best` = the highest-scored item on the **whole current menu** (any
  section — a fleet attack not taken is tempo lost too);
- `chosen` = the item the model picked; a **pass** or END TURN counts as
  score `0`;
- if `best.score − chosen.score ≥ TEMPO_GUARD_TURNS`, the policy returns
  `best` in place of `chosen`, keeps the model's table talk and note, and
  records on the row `guard: { picked: <id or null>, taken: <id>, gap }`.

The sectioned flow's section pointer does not move for a guarded move (the
next ask is the same section with the outcome line, as after any accepted
move); a guarded fleet attack pauses the turn as any battle does and the
turn resumes at ACTIVATE per the sectioned spec. The single flow drops the
rest of its plan after a guarded move (the board changed on a premise the
plan did not hold) and is re-asked, as after any refused move.

`TEMPO_GUARD_TURNS = Infinity` disables the guard; `0` makes the model a
narrator.

### 6.3 Pruning (optional)

When `MENU_SCORE_WINDOW_TURNS` is finite, the turn menu shown to the model
keeps only items scoring within the window of the best, **plus END TURN**;
the guard still reads the full menu. Default **2** — the §10.2 matrix's
shipped variant (V3, §13; fewer items, fewer bad picks, fewer guard
re-asks, at lower latency and cost than the unwindowed guard); `Infinity`
turns pruning off.

### 6.4 Fallback

Both model policies take `scoredPolicy` as their fallback; the driver's
last-resort `FALLBACK` map is unchanged. With no key, or the kill switch on,
`makeBotPolicy` returns today's disabled model policy, whose fallback is now
`scoredPolicy` (the `disabled` row still files). For `BOT_FLOW=scored` it
returns `scoredPolicy` widened to `ModelBackedPolicy` — `rows` empty,
`modelId 'scored'`, the default settings — so the functions' wiring reads
it like any other policy and files no rows.

## 7. Telemetry — `public.bot_decisions`

`TelemetryRow.guard: { picked: number | null; taken: number; gap: number } | null`
→ column `guard jsonb null` (migration
`supabase/migrations/20260919120000_bot_decisions_guard.sql`). The eval
prints how often the guard fired and the mean gap, per flow.

## 8. Settings — `llmSettings.ts` and `evaluator.ts`

| Setting | Default | Where |
|---|---|---|
| `TEMPO_GUARD_TURNS` | 1.0 (§13: the owner kept it) | llmSettings.ts |
| `MENU_SCORE_WINDOW_TURNS` | 2 (§13 matrix; `Infinity` = off) | llmSettings.ts |
| `EVALUATOR.capTurns` | 60 | evaluator.ts |
| `EVALUATOR.battleSamples` | 6 | evaluator.ts |
| `EVALUATOR.board / hand / baseHp / win` | 0.4 / 0.1 / 0.0005 / 1000 | evaluator.ts |

`BOT_FLOW` accepts `scored` (`botFlowFor`). `--flow scored` and
`--opponent heuristic|scored` on the eval.

## 9. Files touched

- new `shared/ai/evaluator.ts`, `evaluator.test.ts`
- new `shared/ai/scoredPolicy.ts`, `scoredPolicy.test.ts`
- `shared/ai/llm/moveMenu.ts` (+ test): `score`, scoring in `buildMenu`
- `shared/ai/llm/prompt.ts`, `sections.ts` (+ tests): the bracketed delta, the window
- `shared/ai/llm/rulesPrimer.ts` (+ test): the HOW YOU PLAY lines, `TEMPO_GUARD_TURNS` placeholder
- `shared/ai/llm/llmPolicy.ts`, `sectionedPolicy.ts` (+ tests): the guard, `scoredPolicy` fallback
- `shared/ai/llm/telemetry.ts` (+ test), migration: `guard`
- `shared/ai/llm/llmSettings.ts`: the two settings
- `shared/ai/llm/makePolicy.ts` (+ test): `scored` flow, fallbacks
- `supabase/functions/shared-manifest.json` + `npm run functions:sync`: `evaluator.ts`, `scoredPolicy.ts`, `battleSim.ts` (the evaluator's battle samples) — `battleSim.ts` moves from eval-only to shipped code
- `scripts/eval-bot.ts`: `--flow scored`, `--opponent`, the guard line
- docs: `docs/claude/architecture.md` (the evaluator, the guard), `CLAUDE.md` (`BOT_FLOW=scored`)

## 10. Test plan

### 10.1 Unit, offline

- evaluator: strike power skips subs / Inoffensive / noBaseDamage /
  Temporary and counts fresh hulls; turns-to-win is the second smallest,
  Blocker and no-power stall a zone at the cap, a fallen base counts 0;
  position score rises when the bot deploys a striker and falls when the
  enemy does, ±1000 on a decided game; scoreMove: END TURN scores its state,
  a deploy scores above END TURN, a bombardment above no bombardment, a
  fleet attack against a far dearer fleet scores below END TURN and against
  a far cheaper one above it, deterministic per seed.
- moveMenu: turn items carry deltas, END TURN carries 0, other kinds `null`.
- scoredPolicy: best first, END TURN loses ties, non-turn kinds are the
  heuristic's; a 12-game mirror net against `basicPolicy` from seed 1 (a
  seeded, deterministic game set) wins at least 9.
- prompt/sections/primer: the bracket renders, the window hides and keeps
  END TURN, the primer names the guard through the placeholder.
- policies: a pick below the margin is replaced by the best and the row
  carries `guard`; a pass with a big deploy available plays the deploy; END
  TURN with a big deploy available plays the deploy; `Infinity` never guards.
- telemetry/migration: the column maps; drift test green after the sync.

### 10.2 The eval — the acceptance test for goal A

All runs: 20 games, seed 1, mirror, calibrated resolver, Mercury default
effort, opponent `basicPolicy`. The baseline is whatever the pre-change
flows score under the same settings (measured 2026-09-19, recorded in §13).

| Variant | Guard | Window | Flow |
|---|---|---|---|
| V1 advisory | ∞ | ∞ | single, sections |
| V2 guard | 1.0 | ∞ | single, sections |
| V3 guard + window | 1.0 | 2.0 | single, sections |
| V4 scored | – | – | scored |

The defaults ship as the best-scoring variant whose flow still talks (the
model still chooses inside the margin); `scored` ships as a flow regardless.
Goal A is met when the shipped default beats the baseline by at least 20
points (a 20-game run's noise is ~11 points; the paired seeds narrow it).

### 10.3 Smoke and board

`node scripts/smoke-practice.mjs` after the deploy; `bot_decisions` rows
carry `guard` where it fired; the human's board is unchanged.

## 11. Rulings

1. The evaluator is **one ply**. It cannot see that an ability that grants
   materials enables a deploy in the same turn; the guard margin gives the
   model room for such moves, and §12 names the rollout.
2. Battle samples assume the defender withdraws nothing and the bot repairs
   nothing — the harness's report and the heuristic's decision. Both are
   pessimistic for the bot's own losses, which is the safe side — except
   for a fleet the human can withdraw *entirely*, where "withdraws nothing"
   is the optimistic reading: the human fights only by choice and the score
   (tens of turns for a lone Stealthy hull) is for a fight that never
   happens. That case never reaches the evaluator: the menu withholds it
   (LLM spec §4.2, amended 2026-09-20). A partly withdrawable fleet is still
   scored as if it stood, and §12's scored responses are where a better
   model of the defender would go.
3. `battleSim.ts` **is shipped code** — synced into both functions as the
   evaluator's battle stand-in, because the samples need one where the menu
   is built; its calibration stays the eval's business. Its loss law is the
   square law `r² / (1 + r²)` (§3.4 step 3): under the linear law the
   evaluator's fleet-attack test could not pass, because every fight was
   zero-sum in expected cost whoever was stronger.
4. The guard reads the whole menu, not the section, so a skipped fight is
   guarded at END TURN.
5. The eval keeps `basicPolicy` as the opponent for comparability; the
   92 % scored-vs-heuristic figure is the ceiling the model is measured
   against, not the bar.

## 12. Follow-ups

- Greedy rollout scoring (each candidate completed by best single moves
  before END TURN) if abilities-then-deploy combos show up in post-mortems.
- Scored decisions (repair when the hull's tempo is worth its cost) and
  scored responses (withdraw a Stealthy hull from a losing fight).
- The DWG bot deck is far stronger than SS's and WF's in this engine
  (heuristic vs heuristic 90 % / 36 % / 24 %): a deck-curation note for the
  owner, not this spec.
- A margin expressed relative to the position's scale, not flat turns: a
  zone claim scores roughly 50 turns of tempo under the evaluator's cap
  while a bombardment scores roughly 1, so one `TEMPO_GUARD_TURNS` value
  cannot be fine-grained on one and decisive on the other — the guard is
  all-or-nothing today (§13).
- Re-measure after the enemy-profile braces (`a309e99`): they landed after
  this matrix's pinned commit (`a53f337`) and were not measured by it (§13).

## 13. Closeout

The §10.2 matrix ran after this branch's final review, from a checkout that
carries the review's fixes (the pre-fix `scoredPolicy` looped on a
zero-delta move, §5, which would have skewed every fallback path). Every
run was 20 games, mirror pairing, seed 1, Mercury 2.5 at its default
effort, opponent `basicPolicy`, the calibrated square-law resolver. V0 ran
from `e8b9734` — the resolver change alone, before scores or the guard;
V1 through V4 ran from `a53f337`, everything this spec describes.

| Variant | Single | Sections |
|---|---|---|
| V0 baseline (no scores, no guard) | 7/20 (35 %) · p50 6.2 s · $0.011 · DWG 3-4 SS 1-6 WF 3-3 | 13/20 (65 %) · p50 14.8 s · $0.033 · DWG 5-2 SS 4-3 WF 4-2 |
| V1 advisory (scores shown, guard ∞) | 16/20 (80 %) · 6.2 s · $0.011 · DWG 5-2 SS 5-2 WF 6-0 | 14/20 (70 %) · 14.7 s · $0.027 · DWG 5-2 SS 6-1 WF 3-3 |
| V2 scores + guard 1.0 | 17/20 (85 %) · 9.7 s · $0.015 · guard fired 172/399 turn rows, mean gap 32.7 · DWG 6-1 SS 5-2 WF 6-0 | 17/20 (85 %) · 16.6 s · $0.026 · guard 154/735, mean gap 114 · DWG 5-2 SS 6-1 WF 6-0 |
| V3 scores + guard 1.0 + window 2 (SHIPPED) | 18/20 (90 %) · 8.0 s · $0.010 · guard 117/331 · DWG 7-0 SS 6-1 WF 5-1 | 19/20 (95 %) · 13.2 s · $0.020 · guard 100/693 · DWG 6-1 SS 7-0 WF 6-0 |
| V4 evaluator alone (`scored`) | 19/20 (95 %) · 28 ms · $0 · DWG 7-0 SS 6-1 WF 6-0 | — |

Goal A is met by far more than the 20 points asked: V3 beats V0 by 55
points single (35 % → 90 %) and 30 points sections (65 % → 95 %). The
numbers alone (V1) carry most of the single flow's gain — 45 of the 55
points (35 % → 80 %) — but not the sectioned flow's — 5 of the 30 (65 % →
70 %); most of sections' gain is the guard's (V2), not the numbers on
their own.

The guard's fire rate and mean gap say what it actually spends its margin
on: at 1.0 it fired on 172 of 399 turn rows single and 154 of 735 sections
(V2), with a mean gap of 32.7 and 114 turns — far past the margin itself.
Read against a board where a zone-claiming deploy (worth roughly 50 turns
of tempo under the evaluator's 60-turn cap) is sitting on the menu, that
says the guard is firing almost entirely on a pass or an END TURN the
model offered while the biggest move on the board went untaken, not on
close calls between comparable moves. At margin 1.0 the model is a
narrator in those states and a chooser everywhere else.

The window's win over V2 is not accuracy: V3 leads V2 by 5 points single
(85 % → 90 %) and 10 points sections (85 % → 95 %), both inside the ~11
points of noise a 20-game run at temperature 0.7 carries, so this is a
consistent direction across both flows rather than a proven gap. What the
window does prove is fewer items — shorter prompts, fewer bad picks, fewer
guard re-asks — and it lands faster and cheaper than V2 in both flows
(single 8.0 s / $0.010 vs 9.7 s / $0.015; sections 13.2 s / $0.020 vs
16.6 s / $0.026).

V4, the evaluator alone with no model, scores 95 % single at 28 ms and $0 a
game — the ceiling the model is measured against (§11 ruling 5), not the
bar it has to clear.

**Shipped**: the owner kept the guard at `TEMPO_GUARD_TURNS = 1.0` and
`sections` as the default flow (`BOT_FLOW` unset); `MENU_SCORE_WINDOW_TURNS`
ships at **2** (V3, this table).

**Two eval lessons.** Mirror pairing: the cross-faction matrix the 2026-09-19
rebuild replaced (§1) read roughly 90 % faction and 10 % policy — the
stronger deck won almost regardless of which policy played it — which is
why every run above pairs each faction against itself. New this matrix:
with `scoredPolicy` as the fallback, a provider outage inflates the
model's own number instead of suppressing it, because a tripped policy
still plays by score rather than at random — one V1-sections run hit 104
HTTP 429s mid-run and read 90 % before it was thrown out and re-run clean
at 70 %. The fallback rate line is read before the win rate on every run
from here on, not after.

The enemy-profile braces (`a309e99`) landed after this matrix's pinned
commit (`a53f337`) and were not measured by it; re-measuring once there is
reason to expect they move the number is a follow-up (§12).

For history, not as this matrix's baseline: the flows scored 55 % single
and 65 % sections against the same opponent before the square-law
resolver. V0 above — after the resolver change but before scores or the
guard — is the number goal A is measured against.
