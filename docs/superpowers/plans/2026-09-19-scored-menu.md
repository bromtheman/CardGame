# Scored Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score every verified PracticeAI menu move in turns of tempo with a one-ply evaluator, show the model the numbers, refuse moves that throw tempo away (the tempo guard), and ship the evaluator as a flow and as the fallback.

**Architecture:** `shared/ai/evaluator.ts` is pure: position score + trial-apply-then-END-TURN scoring, fleet attacks averaged over `battleSim.ts` samples. `buildMenu` attaches a tempo delta to every turn item. `scoredPolicy` ranks the menu; both model policies render the delta, prune by an optional window, and run the chosen item through `guardPick`. `makePolicy` wires the `scored` flow and the new fallback; telemetry and the eval report the guard.

**Tech Stack:** TypeScript (strict), vitest, the engine's `applyAction` (pure, clones), Deno edge functions fed by `npm run functions:sync`.

**Spec:** `docs/superpowers/specs/2026-09-19-scored-menu-design.md` — read it first; every task below cites its section.

## Global Constraints

- Relative imports inside `shared/` carry the `.ts` extension (Deno runs the files verbatim).
- Consumers import `shared/engine/index.ts`, never an engine module directly.
- Every commit touching `shared/` includes `npm run functions:sync` output; new shared modules go into `supabase/functions/shared-manifest.json` for BOTH `game-action` and `lobby-action` (both build the bot policy) or `supabase/seed/functionSharedSync.test.ts` fails.
- Every LLM number lives in `shared/ai/llm/llmSettings.ts`; evaluator weights live in `EVALUATOR` in `evaluator.ts` (spec §8).
- The primer template and `HOW_YOU_PLAY` carry no literal digit (rulesPrimer.test.ts); numbers arrive through `{{PLACEHOLDERS}}`.
- `state.log` never names a card in a hidden hand; the evaluator writes nothing to the log (it only reads trial states).
- Tests: `npx vitest run <file>`; never `--root`. Typecheck: `npx tsc -p tsconfig.json --noEmit`. Edge functions: `npm run functions:check`.
- PowerShell is the shell on this machine: no `&&` — chain with `;` or separate calls.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Do NOT run `npm run bot:eval` from a task — the evals are orchestrated outside this plan (one Mercury client at a time).

---

### Task 1: `botOwes` gets its own module (no import cycle for the evaluator)

The evaluator (Task 2) needs "what does the bot owe" but must not import `botDriver.ts`, which imports `moveMenu.ts`, which will import the evaluator — a cycle. Move the function, re-export it from the driver so every importer keeps working.

**Files:**
- Create: `shared/ai/botOwes.ts`
- Modify: `shared/ai/botDriver.ts` (remove the function body, add `export { botOwes } from './botOwes.ts'`)
- Modify: `supabase/functions/shared-manifest.json` (add `"ai/botOwes.ts"` after `"ai/botView.ts"` in both `game-action` and `lobby-action`)
- Test: `shared/ai/botOwes.test.ts`

**Interfaces:**
- Produces: `botOwes(game: EngineGame, botSide: Side): OwedKind | null` from `shared/ai/botOwes.ts`, identical behaviour; still importable from `shared/ai/botDriver.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// shared/ai/botOwes.test.ts
import { describe, expect, it } from 'vitest'
import { makeGame } from '../engine/testFixtures'
import { botOwes as fromDriver } from './botDriver'
import { botOwes } from './botOwes'

describe('botOwes', () => {
  it('is the driver’s botOwes, moved: turn for the active bot, null for the human’s turn and for a finished game', () => {
    expect(botOwes).toBe(fromDriver)
    const mine = makeGame({ activePlayer: 'bob' })
    expect(botOwes(mine, 'b')).toBe('turn')
    expect(botOwes(mine, 'a')).toBeNull()
    expect(botOwes({ ...mine, status: 'complete' }, 'b')).toBeNull()
  })
  it('puts a pending choice first, then the battle windows, in the order applyAction freezes things', () => {
    const g = makeGame({ activePlayer: 'bob' })
    g.state.pendingEffect = { side: 'b', options: [] } as unknown as typeof g.state.pendingEffect
    expect(botOwes(g, 'b')).toBe('choice')
    expect(botOwes(g, 'a')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run shared/ai/botOwes.test.ts`
Expected: FAIL — cannot resolve `./botOwes`.

- [ ] **Step 3: Move the function**

`shared/ai/botOwes.ts`:

```ts
import type { EngineGame, Side } from '../engine/engineTypes.ts'
import { otherSide } from '../engine/index.ts'
import type { OwedKind } from './basicPolicy.ts'

// What the bot owes right now, in the order applyAction freezes things:
// a pending choice first, then the battle windows, then the turn (2026-09-16
// AI opponent spec §5.1). Null means the human owes the next action — or
// nobody does, because the game is over or a locked battle is waiting to be
// fought in From The Depths. The bot never submits a report, so a report it
// submitted is unreachable. Its own module (2026-09-19 scored menu spec §3)
// so the evaluator can ask without importing the driver, which imports the
// menu, which imports the evaluator.
export function botOwes(game: EngineGame, botSide: Side): OwedKind | null {
  if (game.status !== 'active') return null
  const s = game.state
  if (s.pendingEffect) return s.pendingEffect.side === botSide ? 'choice' : null
  if (s.awaitingResponse) return otherSide(s.awaitingResponse.aggressor) === botSide ? 'response' : null
  if (s.pendingReport) return s.pendingReport.submittedBy !== botSide ? 'decision' : null
  if (s.activeBattle) return null
  const botId = botSide === 'a' ? game.playerA : game.playerB
  return game.activePlayer === botId ? 'turn' : null
}
```

In `shared/ai/botDriver.ts`: delete the `botOwes` function and its comment block (lines 22–38 of the current file), keep `otherSide` only if still used (it is not — drop it from the engine import), and add at the top with the other re-export:

```ts
import { botOwes } from './botOwes.ts'
export { botOwes } from './botOwes.ts'
```

Add `"ai/botOwes.ts"` right after `"ai/botView.ts"` in both function lists of `supabase/functions/shared-manifest.json`.

- [ ] **Step 4: Run the tests and the sync**

Run: `npx vitest run shared/ai/botOwes.test.ts shared/ai/botDriver.test.ts`
Expected: PASS.
Run: `npm run functions:sync` then `npx vitest run supabase/seed/functionSharedSync.test.ts`
Expected: the sync lists `botOwes.ts` for both functions; the drift test passes.

- [ ] **Step 5: Commit**

```bash
git add shared/ai/botOwes.ts shared/ai/botOwes.test.ts shared/ai/botDriver.ts supabase/functions/shared-manifest.json supabase/functions
git commit -m "refactor(ai): botOwes in its own module, re-exported by the driver" -m "The evaluator needs it without importing the driver (which imports the menu, which will import the evaluator)." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The evaluator — position score

Spec §3.1–§3.3.

**Files:**
- Create: `shared/ai/evaluator.ts`
- Test: `shared/ai/evaluator.test.ts`

**Interfaces:**
- Produces: `EVALUATOR` (weights), `strikePower(hulls: readonly ZoneCardEntry[]): number`, `turnsToWin(game: EngineGame, attacker: Side): number`, `positionScore(game: EngineGame, side: Side): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// shared/ai/evaluator.test.ts
import { describe, expect, it } from 'vitest'
import { KEYWORDS } from '../gameSettings'
import { makeGame, zoneEntry } from '../engine/testFixtures'
import { EVALUATOR, positionScore, strikePower, turnsToWin } from './evaluator'

const hull = (cost: number, over: Parameters<typeof zoneEntry>[0] = {}) => zoneEntry({ materialCost: cost, vehicleType: 'ship', ...over })

describe('strikePower', () => {
  it('sums floor(cost / divisor) over hulls that can strike, fresh deployments included', () => {
    expect(strikePower([hull(150000, { playedOnTurn: 5 }), hull(40999)])).toBe(150 + 40)
  })
  it('skips submarines, Inoffensive, noBaseDamage and Temporary hulls', () => {
    expect(strikePower([
      hull(100000, { vehicleType: 'sub' }),
      hull(100000, { keywords: [KEYWORDS.INOFFENSIVE] }),
      hull(100000, { meta: { noBaseDamage: true } }),
      hull(100000, { keywords: [KEYWORDS.TEMPORARY] }),
    ])).toBe(0)
  })
})

describe('turnsToWin', () => {
  it('is the second-smallest zone time: two bases must fall', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(hull(500000))   // 1000 HP / 500 = 2 turns
    g.state.zones[1].cards.b.push(hull(100000))   // 10 turns
    expect(turnsToWin(g, 'b')).toBe(10)
    expect(turnsToWin(g, 'a')).toBe(EVALUATOR.capTurns)   // a strikes nowhere
  })
  it('counts a fallen base as zero and stalls a zone with no power or an enemy Blocker at the cap', () => {
    const g = makeGame()
    g.state.zones[0].baseHp.a = 0
    g.state.zones[1].cards.b.push(hull(200000))
    g.state.zones[1].cards.a.push(hull(40000, { keywords: [KEYWORDS.BLOCKER] }))
    g.state.zones[2].cards.b.push(hull(250000))   // 4 turns
    expect(turnsToWin(g, 'b')).toBe(4)            // [0, cap, 4] → second smallest
  })
})

describe('positionScore', () => {
  it('rises when the bot fields a striker and falls when the enemy does', () => {
    const empty = makeGame()
    const mine = makeGame(); mine.state.zones[0].cards.b.push(hull(200000)); mine.state.zones[1].cards.b.push(hull(200000))
    const theirs = makeGame(); theirs.state.zones[0].cards.a.push(hull(200000)); theirs.state.zones[1].cards.a.push(hull(200000))
    expect(positionScore(mine, 'b')).toBeGreaterThan(positionScore(empty, 'b'))
    expect(positionScore(theirs, 'b')).toBeLessThan(positionScore(empty, 'b'))
    expect(positionScore(mine, 'b')).toBeCloseTo(-positionScore(mine, 'a') + 2 * EVALUATOR.hand * 0, 5)   // symmetric with empty hands
  })
  it('values board cost, hand size and base HP as tie-breakers, in that order of weight', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(hull(100000, { vehicleType: 'sub' }))   // no strike power, still a hull
    expect(positionScore(g, 'b')).toBeGreaterThan(positionScore(makeGame(), 'b'))
    const drew = makeGame({ privates: { a: { hand: [], deck: [] }, b: { hand: [zoneEntry(), zoneEntry()], deck: [] } } })
    expect(positionScore(drew, 'b') - positionScore(makeGame(), 'b')).toBeCloseTo(2 * EVALUATOR.hand, 5)
    const hurt = makeGame(); hurt.state.zones[0].baseHp.a = 800
    expect(positionScore(hurt, 'b') - positionScore(makeGame(), 'b')).toBeCloseTo(200 * EVALUATOR.baseHp, 5)
  })
  it('is ±win on a decided game', () => {
    const g = makeGame({ status: 'complete', winnerId: 'bob' })
    expect(positionScore(g, 'b')).toBe(EVALUATOR.win)
    expect(positionScore(g, 'a')).toBe(-EVALUATOR.win)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run shared/ai/evaluator.test.ts`
Expected: FAIL — cannot resolve `./evaluator`.

- [ ] **Step 3: Implement**

```ts
// shared/ai/evaluator.ts
import { BASE_DAMAGE_DIVISOR, KEYWORDS, MATERIALS_PER_TURN, VEHICLE_TYPES } from '../gameSettings.ts'
import type { EngineGame, Side, ZoneCardEntry } from '../engine/engineTypes.ts'
import { effectiveMaterialCostOf, otherSide } from '../engine/index.ts'

// A one-ply position evaluator in TURNS OF TEMPO (2026-09-19 scored menu
// spec §3). Under this engine a game is a two-base bombardment race: the
// score is how many turns the enemy needs to fell the bot's second base
// minus how many the bot needs for theirs, plus small board, hand and
// base-HP terms. Weights are the ones the 92 % self-play experiment used.
export const EVALUATOR = {
  capTurns: 60,        // a zone nobody can fell "takes" this long
  battleSamples: 6,    // resolver draws averaged for a fleet attack (§3.4)
  choiceDepth: 4,      // pending choices resolved per trial before giving up
  board: 0.4,          // per turn of income of board-cost advantage
  hand: 0.1,           // per card in the bot's hand
  baseHp: 0.0005,      // per HP of base advantage (1000 HP = half a turn)
  win: 1000,           // a decided game
} as const

// Base damage a set of hulls deals per bombardment once eligible: not subs,
// not Inoffensive, not noBaseDamage, not Temporary (removed at the next turn
// start, so they never strike). Hulls played this turn count — the score is
// read at the start of the enemy's turn, and they strike on the bot's.
export function strikePower(hulls: readonly ZoneCardEntry[]): number {
  return hulls.reduce((sum, c) => {
    if (c.vehicleType === VEHICLE_TYPES.SUB) return sum
    if (c.keywords.includes(KEYWORDS.INOFFENSIVE) || c.keywords.includes(KEYWORDS.TEMPORARY)) return sum
    if (c.meta.noBaseDamage === true) return sum
    return sum + Math.floor(effectiveMaterialCostOf(c) / BASE_DAMAGE_DIVISOR)
  }, 0)
}

// Turns until `attacker` fells the defender's SECOND base at current power,
// every zone bombarding in parallel: a fallen base is 0, a zone with a
// defending Blocker or no striker stalls at the cap, else HP / power.
export function turnsToWin(game: EngineGame, attacker: Side): number {
  const defender = otherSide(attacker)
  const times = game.state.zones.map((z) => {
    const hp = z.baseHp[defender]
    if (hp <= 0) return 0
    if (z.cards[defender].some((c) => c.keywords.includes(KEYWORDS.BLOCKER))) return EVALUATOR.capTurns
    const power = strikePower(z.cards[attacker])
    return power > 0 ? Math.min(EVALUATOR.capTurns, hp / power) : EVALUATOR.capTurns
  }).sort((x, y) => x - y)
  return times.length > 1 ? times[1] : (times[0] ?? EVALUATOR.capTurns)
}

const boardCost = (game: EngineGame, side: Side): number =>
  game.state.zones.reduce((s, z) => s + z.cards[side].reduce((t, c) => t + effectiveMaterialCostOf(c), 0), 0)

export function positionScore(game: EngineGame, side: Side): number {
  const enemy = otherSide(side)
  const me = side === 'a' ? game.playerA : game.playerB
  if (game.status !== 'active') return game.winnerId === me ? EVALUATOR.win : -EVALUATOR.win
  const income = MATERIALS_PER_TURN * Math.max(1, Math.floor(game.turnNumber))
  return turnsToWin(game, enemy) - turnsToWin(game, side)
    + EVALUATOR.board * (boardCost(game, side) - boardCost(game, enemy)) / income
    + EVALUATOR.hand * game.privates[side].hand.length
    + EVALUATOR.baseHp * game.state.zones.reduce((t, z) => t + z.baseHp[side] - z.baseHp[enemy], 0)
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run shared/ai/evaluator.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** (no manifest change yet — the menu adds the module in Task 4)

```bash
git add shared/ai/evaluator.ts shared/ai/evaluator.test.ts
git commit -m "feat(ai): position evaluator in turns of tempo" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The evaluator — scoring a move

Spec §3.4. Trial-apply, resolve the bot's pending choices with the heuristic's first option, average a fleet attack over resolver samples, end the turn, score.

**Files:**
- Modify: `shared/ai/evaluator.ts`
- Test: `shared/ai/evaluator.test.ts`

**Interfaces:**
- Consumes: `resolveBattle(game, rng)` from `shared/ai/battleSim.ts`; `botOwes` from `shared/ai/botOwes.ts`; `basicPolicy` and `viewFor`.
- Produces: `scoreMove(game: EngineGame, botId: string, action: GameAction, ctx: EngineContext, seed: number): number | null`.

- [ ] **Step 1: Write the failing tests** (append to `evaluator.test.ts`)

```ts
import { makeCtx } from '../engine/testFixtures'
import { inst } from '../engine/testFixtures'
import { scoreMove } from './evaluator'

const BOT = 'bob'
function turnGame() {
  // The bot (b) holds a 100k ship it can afford; a 150k hull of its own sits in zone 1 from an earlier turn.
  const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ship-100', materialCost: 100000 })], deck: [] } } })
  g.state.resources.b.materials = 225000
  g.state.zones[0].cards.b.push(hull(150000, { instanceId: 'mine-1', playedOnTurn: 1 }))
  return g
}

describe('scoreMove', () => {
  it('scores END TURN as the position it leaves, a deploy above it, and a bombardment above no bombardment', () => {
    const g = turnGame()
    const end = scoreMove(g, BOT, { type: 'END_TURN' }, makeCtx(), 1)!
    const deploy = scoreMove(g, BOT, { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ship-100', zoneId: 2 }, makeCtx(), 1)!
    const bombard = scoreMove(g, BOT, { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx(), 1)!
    expect(deploy).toBeGreaterThan(end)
    expect(bombard).toBeGreaterThan(end)
  })
  it('returns null for a move the engine refuses', () => {
    expect(scoreMove(turnGame(), BOT, { type: 'ATTACK_ENEMY_BASE', zoneId: 3 }, makeCtx(), 1)).toBeNull()
  })
  it('is deterministic per seed', () => {
    const g = turnGame()
    const a = { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ship-100', zoneId: 1 } as const
    expect(scoreMove(g, BOT, a, makeCtx(), 7)).toBe(scoreMove(g, BOT, a, makeCtx(), 7))
  })
  it('scores a fleet attack by playing the battle out: below END TURN against a far dearer fleet, above it against a far cheaper one', () => {
    const outgunned = turnGame()
    outgunned.state.zones[0].cards.a.push(hull(600000, { instanceId: 'big-1' }), hull(600000, { instanceId: 'big-2' }))
    const easy = turnGame()
    easy.state.zones[0].cards.a.push(hull(20000, { instanceId: 'small-1' }))
    const attack = { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 } as const
    expect(scoreMove(outgunned, BOT, attack, makeCtx(), 3)!).toBeLessThan(scoreMove(outgunned, BOT, { type: 'END_TURN' }, makeCtx(), 3)!)
    expect(scoreMove(easy, BOT, attack, makeCtx(), 3)!).toBeGreaterThan(scoreMove(easy, BOT, { type: 'END_TURN' }, makeCtx(), 3)!)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run shared/ai/evaluator.test.ts`
Expected: FAIL — `scoreMove` is not exported.

- [ ] **Step 3: Implement** (append to `evaluator.ts`; extend the imports)

```ts
import type { EngineContext, GameAction } from '../engine/engineTypes.ts'
import { applyAction, sideOf } from '../engine/index.ts'
import { basicPolicy } from './basicPolicy.ts'
import { botOwes } from './botOwes.ts'
import { viewFor } from './botView.ts'
import { resolveBattle } from './battleSim.ts'
import { mulberry32 } from './seededRng.ts'

const withRng = (ctx: EngineContext, seed: number): EngineContext => ({ ...ctx, rng: mulberry32(seed >>> 0) })
const playerOf = (game: EngineGame, side: Side): string => (side === 'a' ? game.playerA : game.playerB)

// Resolves whatever choice a trial left pending, for either side: the bot's
// through basicPolicy's order, the enemy's by its first option (or cancel).
function settleChoices(input: EngineGame, ctx: EngineContext): EngineGame | null {
  let game = input
  for (let guard = 0; guard < EVALUATOR.choiceDepth && game.state.pendingEffect; guard++) {
    const p = game.state.pendingEffect
    const actor = playerOf(game, p.side)
    const options: GameAction[] = sideOf(game, actor) && botOwes(game, p.side) === 'choice'
      ? basicPolicy.candidates(viewFor(game, p.side, ctx.rng), 'choice')
      : []
    if (options.length === 0) options.push(p.options.length ? { type: 'RESOLVE_PENDING_EFFECT', choiceId: p.options[0].id } : { type: 'RESOLVE_PENDING_EFFECT', cancel: true })
    let settled = false
    for (const action of options) {
      const r = applyAction(game, actor, action, ctx)
      if (r.ok) { game = r.game; settled = true; break }
    }
    if (!settled) return null
  }
  return game.state.pendingEffect ? null : game
}

// The position at the start of the enemy's turn if the bot ended now.
function endedScore(input: EngineGame, botId: string, side: Side, ctx: EngineContext): number | null {
  const game = settleChoices(input, ctx)
  if (!game) return null
  const owed = botOwes(game, side)
  if (owed === null) return positionScore(game, side)   // the game ended on this move
  if (owed !== 'turn') return null
  const r = applyAction(game, botId, { type: 'END_TURN' }, ctx)
  return r.ok ? positionScore(r.game, side) : null
}

// A fleet attack played out EVALUATOR.battleSamples times: the defender
// withdraws nothing and reports a resolver draw, the bot approves repairing
// nothing, choices settle, the turn ends, the position is scored. The mean
// of the samples that completed; null if none did.
function battleMean(declared: EngineGame, botId: string, side: Side, ctx: EngineContext, seed: number): number | null {
  const enemyId = playerOf(declared, otherSide(side))
  const scores: number[] = []
  for (let k = 0; k < EVALUATOR.battleSamples; k++) {
    const sample = withRng(ctx, seed + 7919 * (k + 1))
    const responded = applyAction(declared, enemyId, { type: 'RESPOND_TO_ATTACK', optOutIds: [] }, sample)
    if (!responded.ok || !responded.game.state.activeBattle) continue
    const reported = applyAction(responded.game, enemyId, { type: 'SUBMIT_BATTLE_REPORT', results: resolveBattle(responded.game, sample.rng), repairs: [] }, sample)
    if (!reported.ok) continue
    const decided = applyAction(reported.game, botId, { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [] }, sample)
    if (!decided.ok) continue
    const s = endedScore(decided.game, botId, side, sample)
    if (s !== null) scores.push(s)
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
}

// The score of the position the bot would hand the enemy by making `action`
// and then ending its turn (spec §3.4); END TURN scores its own trial state;
// null when the engine refuses the move or the trial cannot be completed.
export function scoreMove(game: EngineGame, botId: string, action: GameAction, ctx: EngineContext, seed: number): number | null {
  const side = sideOf(game, botId)
  if (!side) return null
  const trial = applyAction(game, botId, action, withRng(ctx, seed))
  if (!trial.ok) return null
  if (action.type === 'END_TURN') return positionScore(trial.game, side)
  if (action.type === 'ATTACK_ENEMY_FLEET' && trial.game.state.awaitingResponse) return battleMean(trial.game, botId, side, ctx, seed)
  return endedScore(trial.game, botId, side, withRng(ctx, seed + 1))
}
```

Merge the new imports with the existing ones at the top of the file (one import per module; `type` imports stay `import type`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run shared/ai/evaluator.test.ts`
Expected: PASS (9 tests). If the outgunned assertion fails, check that `resolveBattle` is drawing on `sample.rng` (a fresh `mulberry32` per sample) and that `turnGame()`'s `mine-1` has `playedOnTurn: 1` (so the trial's fleet attack has a force).

- [ ] **Step 5: Commit**

```bash
git add shared/ai/evaluator.ts shared/ai/evaluator.test.ts
git commit -m "feat(ai): scoreMove — trial, settle, sample a battle, end the turn, score" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Menu items carry a tempo delta

Spec §3.5, §4. `buildMenu` scores every kept turn item; `score` is the delta against END TURN; the manifest gains the evaluator and the battle resolver.

**Files:**
- Modify: `shared/ai/llm/moveMenu.ts`
- Modify: `supabase/functions/shared-manifest.json` (add `"ai/battleSim.ts"` and `"ai/evaluator.ts"` after `"ai/seededRng.ts"` in both lists)
- Test: `shared/ai/llm/moveMenu.test.ts`

**Interfaces:**
- Produces: `MenuItem.score: number | null`; `tempoTag(score: number | null): string` (`''` for null, else ` [+2.4]` / ` [0.0]` / ` [-1.3]`, one decimal, leading space).

- [ ] **Step 1: Write the failing tests** (append to `moveMenu.test.ts`)

```ts
import { tempoTag } from './moveMenu'

describe('tempo deltas', () => {
  it('scores every turn item against END TURN, which carries 0', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ship-100', materialCost: 100000 })], deck: [] } } })
    g.state.resources.b.materials = 225000
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 150000, playedOnTurn: 1 }))
    const menu = buildMenu(g, BOT, makeCtx(), 'turn')
    const end = menu.find((m) => m.action.type === 'END_TURN')!
    expect(end.score).toBe(0)
    const deploy = menu.find((m) => m.action.type === 'PLAY_CARD_TO_ZONE')!
    const bombard = menu.find((m) => m.action.type === 'ATTACK_ENEMY_BASE')!
    expect(deploy.score).toBeGreaterThan(0)
    expect(bombard.score).toBeGreaterThan(0)
    for (const m of menu) expect(typeof m.score).toBe('number')
  })
  it('leaves the one-move kinds unscored', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.pendingEffect = { id: 'p', side: 'b', prompt: 'pick', options: [{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }] } as unknown as typeof g.state.pendingEffect
    for (const m of buildMenu(g, BOT, makeCtx(), 'choice')) expect(m.score).toBeNull()
  })
  it('still draws exactly one rng value with scoring on', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', keywords: ['mobile'], playedOnTurn: 1 }))
    let draws = 0
    buildMenu(g, BOT, makeCtx({ rng: () => { draws++; return 0.5 } }), 'turn')
    expect(draws).toBe(1)
  })
  it('formats the tag to one decimal with a sign, and nothing for null', () => {
    expect(tempoTag(2.44)).toBe(' [+2.4]')
    expect(tempoTag(-1.26)).toBe(' [-1.3]')
    expect(tempoTag(0)).toBe(' [0.0]')
    expect(tempoTag(-0.04)).toBe(' [0.0]')
    expect(tempoTag(null)).toBe('')
  })
})
```

Check how `pendingEffect` is shaped in `shared/engine/gameInit.ts` (`PendingEffect`) and adjust the literal in the second test to the real fields (an existing test in `moveMenu.test.ts`, "enumerates responses, decisions and choices", builds one — copy its shape).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run shared/ai/llm/moveMenu.test.ts`
Expected: FAIL — `score` undefined, `tempoTag` not exported.

- [ ] **Step 3: Implement**

In `moveMenu.ts`:

```ts
import { scoreMove } from '../evaluator.ts'

export interface MenuItem { id: number; action: GameAction; text: string; section: Section | null; score: number | null }

// The bracketed tempo delta a menu line carries (spec §6.1): one decimal,
// signed, a plain zero for END TURN and for a rounding-zero; nothing for an
// unscored item.
export function tempoTag(score: number | null): string {
  if (score === null) return ''
  const r = Math.round(score * 10) / 10
  return ` [${r > 0 ? '+' : ''}${r.toFixed(1)}]`
}
```

In `buildMenu`: replace the trial-context line and the final `return`:

```ts
  // One rng draw seeds every trial and every score of this build (the
  // "draws exactly one rng value" test), so a build is deterministic.
  const seedBase = Math.floor(ctx.rng() * 2 ** 32)
  const trialCtx: EngineContext = { ...ctx, rng: mulberry32(seedBase) }
  …
    items.push({ id: 0, action, text: describeMenuItem(game, r.game, side, action), section: sectionOf(action), score: null })
  …
  const numbered = kept.map((item, i) => ({ ...item, id: i + 1 }))
  return kind === 'turn' ? scored(game, botId, ctx, numbered, seedBase) : numbered
}

// Every turn item's tempo delta against END TURN (spec §3.5). An item whose
// trial cannot be completed keeps null and stays offered.
function scored(game: EngineGame, botId: string, ctx: EngineContext, items: MenuItem[], seedBase: number): MenuItem[] {
  const raw = items.map((m, i) => scoreMove(game, botId, m.action, ctx, (seedBase + 1 + i) >>> 0))
  const endIndex = items.findIndex((m) => m.action.type === 'END_TURN')
  const end = endIndex >= 0 ? raw[endIndex] : null
  return items.map((m, i) => ({ ...m, score: raw[i] === null || end === null ? null : raw[i]! - end }))
}
```

Add `"ai/battleSim.ts"` and `"ai/evaluator.ts"` after `"ai/seededRng.ts"` in both lists of `supabase/functions/shared-manifest.json`.

- [ ] **Step 4: Run the tests, the sync and the drift test**

Run: `npx vitest run shared/ai/llm/moveMenu.test.ts shared/ai`
Expected: PASS. Every existing test that builds `MenuItem` literals (`sectionedPolicy.test.ts`, `conversation.test.ts`, `prompt.test.ts`, `llmPolicy.test.ts`) may now fail typecheck for the missing `score` — add `score: null` to those literals (or `score: 1` where the test wants a scored item). Run `npx tsc -p tsconfig.json --noEmit` and fix every site it names.
Run: `npm run functions:sync` then `npx vitest run supabase/seed/functionSharedSync.test.ts`
Expected: the sync lists `battleSim.ts` and `evaluator.ts` for both functions; PASS.

- [ ] **Step 5: Commit**

```bash
git add shared supabase/functions
git commit -m "feat(ai): every turn menu item carries its tempo delta" -m "buildMenu scores each kept turn item with the evaluator against END TURN; battleSim.ts and evaluator.ts ship with both functions." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `scoredPolicy` and the `scored` flow

Spec §5, §6.4, §8.

**Files:**
- Create: `shared/ai/scoredPolicy.ts`
- Modify: `shared/ai/llm/makePolicy.ts` (flow, fallbacks), `shared/ai/llm/llmPolicy.ts` and `sectionedPolicy.ts` (`needsMenu` always true — the scored fallback reads the menu)
- Modify: `supabase/functions/shared-manifest.json` (add `"ai/scoredPolicy.ts"` after `"ai/basicPolicy.ts"` in both lists)
- Test: `shared/ai/scoredPolicy.test.ts`, `shared/ai/llm/makePolicy.test.ts`, existing `llmPolicy.test.ts` / `sectionedPolicy.test.ts` "disabled" tests

**Interfaces:**
- Produces: `scoredPolicy: BotPolicy` (needsMenu true), `rankByScore(menu: MenuItem[]): MenuItem[]`, `BotFlow = 'single' | 'sections' | 'scored'`, `botFlowFor('scored') === 'scored'`, `makeBotPolicy({ BOT_FLOW: 'scored' })` → a `ModelBackedPolicy` with `modelId 'scored'` and empty `rows`.

- [ ] **Step 1: Write the failing tests**

```ts
// shared/ai/scoredPolicy.test.ts
import { describe, expect, it } from 'vitest'
import { applyAction } from '../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../engine/testFixtures'
import { basicPolicy } from './basicPolicy'
import { botOwes, runBotUntilIdle } from './botDriver'
import { viewFor } from './botView'
import type { MenuItem } from './llm/moveMenu'
import { rankByScore, scoredPolicy } from './scoredPolicy'
import { matchupFor, newGame, parseFactions, reportBattle, STEP_CAP, TURN_CAP } from './selfPlayHarness'
import { cardId, loadSeedData } from '../../supabase/seed/transform'
import type { SeedCard } from '../types'
import type { SnapshotCard } from '../engine/gameInit'

const item = (id: number, type: MenuItem['action']['type'], score: number | null): MenuItem =>
  ({ id, action: { type } as MenuItem['action'], text: type, section: null, score })

describe('rankByScore', () => {
  it('sorts best first, keeps menu order on ties, and END TURN loses every tie', () => {
    const ranked = rankByScore([item(1, 'END_TURN', 0), item(2, 'ATTACK_ENEMY_BASE', 0.5), item(3, 'PLAY_CARD_TO_ZONE', 0), item(4, 'PLAY_ABILITY_CARD', null), item(5, 'USE_HERO_POWER', 2)])
    expect(ranked.map((m) => m.id)).toEqual([5, 2, 3, 4, 1])
  })
})

describe('scoredPolicy', () => {
  it('plays the best-scored move first and ends the turn only when nothing scores above it', async () => {
    const g = makeGame({ activePlayer: 'bob', turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ship-100', materialCost: 100000 })], deck: [] } } })
    g.state.resources.b.materials = 225000
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 150000, playedOnTurn: 1 }))
    const { game, applied } = await runBotUntilIdle(g, 'bob', makeCtx(), scoredPolicy)
    expect(applied.map((a) => a.type)).toContain('PLAY_CARD_TO_ZONE')
    expect(applied.map((a) => a.type)).toContain('ATTACK_ENEMY_BASE')
    expect(applied[applied.length - 1].type).toBe('END_TURN')
    expect(game.activePlayer).toBe('alice')
  })
  it('answers the one-move kinds with the heuristic’s order', () => {
    const g = makeGame({ activePlayer: 'bob' })
    g.state.pendingEffect = { id: 'p', side: 'b', prompt: 'pick', options: [{ id: 'x', label: 'x' }] } as unknown as typeof g.state.pendingEffect
    const view = viewFor(g, 'b', makeCtx().rng)
    expect(scoredPolicy.candidates(view, 'choice')).toEqual(basicPolicy.candidates(view, 'choice'))
  })
})

// The strength net (spec §10.1): scored vs basicPolicy, 12 seeded mirror
// games — deterministic, so the count is exact, not a probability.
function toSnapshot(card: SeedCard): SnapshotCard {
  return {
    cardId: cardId(card.faction, card.name), name: card.name, isBuiltIn: true, ownerId: null,
    faction: card.faction, type: card.type, vehicleType: card.vehicleType,
    blueprintCost: card.blueprintCost, materialCost: card.materialCost, cpCost: card.cpCost,
    cardText: card.cardText ?? '', imageUrl: card.imageUrl ?? '',
    keywords: card.keywords ?? [], meta: (card.meta ?? {}) as Record<string, unknown>,
  }
}
describe('scoredPolicy against basicPolicy', () => {
  it('wins at least 9 of 12 seeded mirror games', async () => {
    const { cards } = await loadSeedData()
    const catalog = cards.filter((c) => c.isBuiltIn).map(toSnapshot)
    const byName = new Map(catalog.map((c) => [`${c.faction}:${c.name}`, c]))
    const factions = parseFactions('', 'mirror')
    let wins = 0
    for (let i = 0; i < 12; i++) {
      const seed = 1 + i
      const focal: 'a' | 'b' = i % 2 === 0 ? 'b' : 'a'
      const { factionA, factionB } = matchupFor(factions, i, 'mirror')
      const { game: start, ctx, rng } = newGame({ seed, factionA, factionB, catalog, byName })
      let game = start
      const act = async (side: 'a' | 'b') => {
        const id = side === 'a' ? 'alice' : 'bot'
        if (!botOwes(game, side)) return
        game = (await runBotUntilIdle(game, id, ctx, side === focal ? scoredPolicy : basicPolicy)).game
      }
      for (let step = 0; step < STEP_CAP; step++) {
        await act('a'); await act('b')
        if (game.status !== 'active' || game.turnNumber >= TURN_CAP) break
        if (game.state.activeBattle && !game.state.pendingReport && !game.state.pendingEffect) {
          const defender = game.state.activeBattle.aggressor === 'a' ? 'bot' : 'alice'
          const r = applyAction(game, defender, reportBattle(game, rng), ctx)
          if (!r.ok) throw new Error(r.error)
          game = r.game
        }
      }
      if (game.winnerId === (focal === 'a' ? 'alice' : 'bot')) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(9)
  }, 60_000)
})
```

Add to `makePolicy.test.ts`:

```ts
import { scoredPolicy } from '../scoredPolicy'
  it('builds the scored flow on BOT_FLOW=scored: no model, no rows, the menu wanted', () => {
    expect(botFlowFor('scored')).toBe('scored')
    expect(botFlowFor(' Scored ')).toBe('scored')
    const p = makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_FLOW: 'scored' })
    expect(p.modelId).toBe('scored')
    expect(p.rows).toEqual([])
    expect(p.needsMenu).toBe(true)
    expect(p.candidates).toBe(scoredPolicy.candidates)
  })
  it('wants the menu even when disabled or tripped — the scored fallback reads it', () => {
    expect(makeBotPolicy({}).needsMenu).toBe(true)
    expect(makeBotPolicy({ OPENROUTER_API_KEY: 'sk', BOT_LLM_DISABLED: '1' }).needsMenu).toBe(true)
  })
```

and change the first existing test's `needsMenu` expectations (`false` → `true`) to match.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run shared/ai/scoredPolicy.test.ts shared/ai/llm/makePolicy.test.ts`
Expected: FAIL — module missing, `botFlowFor('scored')` is `'sections'`.

- [ ] **Step 3: Implement**

```ts
// shared/ai/scoredPolicy.ts
import type { GameAction } from '../engine/engineTypes.ts'
import { basicPolicy } from './basicPolicy.ts'
import type { BotPolicy, OwedKind } from './basicPolicy.ts'
import type { BotView } from './botView.ts'
import type { MenuItem } from './llm/moveMenu.ts'

// The evaluator playing alone (2026-09-19 scored menu spec §5): the verified
// menu, best tempo delta first. The third flow (BOT_FLOW=scored), the
// fallback inside both model flows, and what plays with no key. Stateless,
// like basicPolicy; the one-move kinds keep the heuristic's order.
export function rankByScore(menu: MenuItem[]): MenuItem[] {
  const value = (m: MenuItem): number => m.score ?? 0
  return [...menu].sort((x, y) => {
    const d = value(y) - value(x)
    if (d !== 0) return d
    // END TURN loses every tie: materials held at END TURN are lost anyway.
    if (x.action.type === 'END_TURN') return 1
    if (y.action.type === 'END_TURN') return -1
    return x.id - y.id
  })
}

export const scoredPolicy: BotPolicy & { readonly needsMenu: true; candidates(view: BotView, kind: OwedKind): GameAction[] } = {
  needsMenu: true,
  candidates(view, kind) {
    const menu = view.menu ?? []
    if (kind !== 'turn' || menu.length === 0) return basicPolicy.candidates(view, kind)
    return [...rankByScore(menu).map((m) => m.action), ...basicPolicy.candidates(view, kind)]
  },
}
```

`makePolicy.ts`:

```ts
import { scoredPolicy } from '../scoredPolicy.ts'

export type BotFlow = 'single' | 'sections' | 'scored'
export const botFlowFor = (raw?: string): BotFlow => {
  const f = (raw ?? '').trim().toLowerCase()
  return f === 'single' ? 'single' : f === 'scored' ? 'scored' : 'sections'
}
…
  const client = disabled ? null : new OpenRouterClient(key, model, fetchImpl)
  const flow = botFlowFor(env.BOT_FLOW)
  if (flow === 'scored') return { ...scoredPolicy, rows: [], modelId: 'scored', settings }
  return flow === 'single'
    ? new LlmPolicy(client, scoredPolicy, model, settings)
    : new SectionedLlmPolicy(client, scoredPolicy, model, settings)
```

Update the header comment: the fallback is the evaluator now (spec §6.4). In `llmPolicy.ts` and `sectionedPolicy.ts` replace the `needsMenu` getter and its comment:

```ts
  // Always: the scored fallback reads the menu, so a tripped or disabled
  // policy still needs one built (2026-09-19 scored menu spec §6.4).
  get needsMenu(): boolean { return true }
```

In `llmPolicy.test.ts` and `sectionedPolicy.test.ts`, the tests named "starts tripped as disabled without a client, builds no menu, and files one disabled row" change to expect `needsMenu` true and a menu built; rename them "…wants a menu for the scored fallback, and files one disabled row". `moveMenu.test.ts`'s existing `MenuItem` literals need `score: null` if Task 4 did not already add it.

Add `"ai/scoredPolicy.ts"` after `"ai/basicPolicy.ts"` in both manifest lists.

- [ ] **Step 4: Run the tests, tsc, sync**

Run: `npx vitest run shared/ai`; `npx tsc -p tsconfig.json --noEmit`; `npm run functions:sync`; `npx vitest run supabase/seed/functionSharedSync.test.ts`
Expected: all PASS; the net test wins ≥ 9 of 12 (the experiment won 11).

- [ ] **Step 5: Commit**

```bash
git add shared supabase/functions
git commit -m "feat(ai): scoredPolicy — the evaluator as a flow and as the model flows' fallback" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Settings, primer lines, the bracket on every turn line, the window

Spec §6.1, §6.3, §8.

**Files:**
- Modify: `shared/ai/llm/llmSettings.ts` (two settings), `rulesPrimer.ts` (HOW YOU PLAY lines + placeholders), `prompt.ts` and `conversation.ts` (render the tag, apply the window), `moveMenu.ts` (`withinWindow`)
- Test: `rulesPrimer.test.ts`, `prompt.test.ts`, `conversation.test.ts`, `moveMenu.test.ts`

**Interfaces:**
- Produces: `TEMPO_GUARD_TURNS = 1`, `MENU_SCORE_WINDOW_TURNS = Infinity` (llmSettings); `withinWindow(menu: MenuItem[], window = MENU_SCORE_WINDOW_TURNS): MenuItem[]` (moveMenu); every turn menu line reads `#<id><tempoTag> <text>`; primer placeholders `{{TEMPO_GUARD_TURNS}}` and `{{TEMPO_GUARD_LINE}}`.

- [ ] **Step 1: Write the failing tests**

`moveMenu.test.ts`:

```ts
import { withinWindow } from './moveMenu'
describe('withinWindow', () => {
  it('keeps items within the window of the best, unscored items, and END TURN always', () => {
    const menu: MenuItem[] = [
      { id: 1, action: { type: 'END_TURN' }, text: 'end', section: 'finish', score: 0 },
      { id: 2, action: { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, text: 'a', section: 'fight', score: 3 },
      { id: 3, action: { type: 'ATTACK_ENEMY_BASE', zoneId: 2 }, text: 'b', section: 'fight', score: 1.5 },
      { id: 4, action: { type: 'ATTACK_ENEMY_BASE', zoneId: 3 }, text: 'c', section: 'fight', score: null },
    ]
    expect(withinWindow(menu, 2).map((m) => m.id)).toEqual([1, 2, 3, 4])
    expect(withinWindow(menu, 1).map((m) => m.id)).toEqual([1, 2, 4])
    expect(withinWindow(menu, Infinity)).toEqual(menu)
  })
})
```

`prompt.test.ts` (add to the existing menu layout test or as a new one):

```ts
  it('prefixes each turn menu line with its tempo delta and leaves unscored lines bare', () => {
    // build `view`/`menu` the way the file's other tests do, then:
    const scoredMenu = menu.map((m, i) => ({ ...m, score: i === 0 ? 0 : 1.25 }))
    const text = buildUserPrompt({ view, kind: 'turn', menu: scoredMenu })
    expect(text).toContain(`#${scoredMenu[0].id} [0.0] ${scoredMenu[0].text}`)
    expect(text).toContain(`#${scoredMenu[1].id} [+1.3] ${scoredMenu[1].text}`)
    const bare = buildUserPrompt({ view, kind: 'turn', menu: menu.map((m) => ({ ...m, score: null })) })
    expect(bare).toContain(`#${menu[0].id} ${menu[0].text}`)
  })
```

`conversation.test.ts`:

```ts
  it('numbers the section’s items with their tempo tags and hides items outside the window, never END TURN', () => {
    const menu: MenuItem[] = [
      { id: 1, action: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'x', zoneId: 1 }, text: 'Deploy X', section: 'deploy', score: 4 },
      { id: 2, action: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'x', zoneId: 2 }, text: 'Deploy X to 2', section: 'deploy', score: 0.5 },
      { id: 3, action: { type: 'END_TURN' }, text: 'End', section: 'finish', score: 0 },
    ]
    expect(numberedMenu(menu, 'deploy').lines).toEqual(['#1 [+4.0] Deploy X', '#2 [+0.5] Deploy X to 2'])
    expect(numberedMenu(menu, 'finish', 1).lines).toEqual(['#1 [+4.0] Deploy X', '#2 [0.0] End'])
  })
```

`rulesPrimer.test.ts`:

```ts
import { MENU_SCORE_WINDOW_TURNS, TEMPO_GUARD_TURNS } from './llmSettings'
  it('explains the tempo tag in both flows and names the guard margin through its placeholder', () => {
    for (const flow of ['single', 'sections'] as const) {
      const text = renderPrimer('DWG', flow)
      expect(text).toContain('tempo estimate in brackets')
      expect(text).toContain(`A move worth ${TEMPO_GUARD_TURNS} turns or more less than the best move is not accepted`)
    }
    expect(PRIMER_TEMPLATE).toContain('{{TEMPO_GUARD_LINE}}')
  })
```

(The no-digit test already covers `HOW_YOU_PLAY`; the new lines must keep every digit inside a placeholder.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run shared/ai/llm/moveMenu.test.ts shared/ai/llm/prompt.test.ts shared/ai/llm/conversation.test.ts shared/ai/llm/rulesPrimer.test.ts`
Expected: FAIL on each new test.

- [ ] **Step 3: Implement**

`llmSettings.ts` (with the other numbers):

```ts
// Scored menu (2026-09-19 spec §6, §8). The tempo guard: a move, a pass or
// END TURN worth this many turns or more below the best available move is
// replaced by the best; Infinity switches it off, 0 makes the model a
// narrator. The window: turn items further below the best than this are not
// shown (END TURN always is); Infinity shows everything.
export const TEMPO_GUARD_TURNS = 1
export const MENU_SCORE_WINDOW_TURNS = Infinity
```

`moveMenu.ts`:

```ts
import { MENU_MAX_ITEMS, MENU_MAX_TRIALS, MENU_SCORE_WINDOW_TURNS } from './llmSettings.ts'

// The items shown to the model under the window (spec §6.3): those within
// `window` of the best score, unscored items, and END TURN always.
export function withinWindow(menu: MenuItem[], window: number = MENU_SCORE_WINDOW_TURNS): MenuItem[] {
  if (!Number.isFinite(window)) return menu
  const best = Math.max(...menu.map((m) => m.score ?? -Infinity))
  return menu.filter((m) => m.score === null || m.action.type === 'END_TURN' || m.score >= best - window)
}
```

`prompt.ts` — the menu lines in `buildUserPrompt`:

```ts
import { tempoTag, withinWindow } from './moveMenu.ts'
…
  out.push('', 'MENU')
  out.push(...(kind === 'turn' ? withinWindow(menu) : menu).map((m) => `#${m.id}${tempoTag(m.score)} ${m.text}`))
```

`conversation.ts`:

```ts
import { tempoTag, withinWindow } from './moveMenu.ts'
export function numberedMenu(menu: MenuItem[], section: Section | null, window: number = MENU_SCORE_WINDOW_TURNS): Numbered {
  const scoped = section === null ? [...menu] : menu.filter((m) => inSection(m.section, section))
  const items = section === null ? scoped : withinWindow(scoped, window)
  return { items, lines: items.map((m, i) => `#${i + 1}${tempoTag(m.score)} ${m.text}`) }
}
```

`rulesPrimer.ts` — append to BOTH `HOW_YOU_PLAY` blocks, before the `note`/`tableTalk` lines:

```
- Each turn move starts with its tempo estimate in brackets: the turns the human needs to fell your second base minus the turns you need for theirs, after that move, compared with ending your turn now. Higher is better and only the differences matter. It counts bombardment and hulls on the board and plays a fleet battle out by cost; it does not see what an ability does later or how well the human fights, so treat it as a compass, not an order.{{TEMPO_GUARD_LINE}}
```

and in `PRIMER_VALUES`:

```ts
  TEMPO_GUARD_TURNS,
  TEMPO_GUARD_LINE: Number.isFinite(TEMPO_GUARD_TURNS) ? ` A move worth ${TEMPO_GUARD_TURNS} turns or more less than the best move is not accepted — the best move is played instead.` : '',
```

`renderPrimer` substitutes `HOW_YOU_PLAY[flow]` first and then the remaining placeholders — check its order: it replaces every `{{KEY}}` in one pass over `PRIMER_TEMPLATE`, so a placeholder INSIDE `HOW_YOU_PLAY` is not substituted. Change `renderPrimer` to run the same replacement twice (the second pass fills placeholders the first pass inserted), and add a test line asserting no `{{` survives in the rendered primer.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run shared/ai/llm`
Expected: PASS, including the no-digit test (the guard's digit lives in `TEMPO_GUARD_LINE`, not in the block).

- [ ] **Step 5: Commit**

```bash
git add shared supabase/functions
git commit -m "feat(ai): the model reads each move's tempo delta; guard margin and window settings" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(run `npm run functions:sync` first; it re-copies the touched modules.)

---

### Task 7: The tempo guard — `guardPick` and the single flow

Spec §6.2, §7.

**Files:**
- Create: `shared/ai/llm/tempoGuard.ts`
- Modify: `shared/ai/llm/telemetry.ts` (`guard` on the row and the DB row), `llmPolicy.ts`
- Create: `supabase/migrations/20260919120000_bot_decisions_guard.sql`
- Modify: `supabase/functions/shared-manifest.json` (add `"ai/llm/tempoGuard.ts"` after `"ai/llm/moveMenu.ts"` in both lists)
- Test: `shared/ai/llm/tempoGuard.test.ts`, `telemetry.test.ts`, `llmPolicy.test.ts`

**Interfaces:**
- Produces: `GuardRecord = { picked: number | null; taken: number; gap: number }`; `guardPick(menu: MenuItem[], chosen: MenuItem | null, margin = TEMPO_GUARD_TURNS): { item: MenuItem | null; guard: GuardRecord | null }`; `TelemetryRow.guard: GuardRecord | null`; DB column `guard jsonb`.

- [ ] **Step 1: Write the failing tests**

```ts
// shared/ai/llm/tempoGuard.test.ts
import { describe, expect, it } from 'vitest'
import type { MenuItem } from './moveMenu'
import { guardPick } from './tempoGuard'

const end: MenuItem = { id: 1, action: { type: 'END_TURN' }, text: 'end', section: 'finish', score: 0 }
const deploy: MenuItem = { id: 2, action: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'x', zoneId: 1 }, text: 'deploy', section: 'deploy', score: 2.5 }
const weak: MenuItem = { id: 3, action: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'x', zoneId: 2 }, text: 'weak', section: 'deploy', score: 1.8 }
const menu = [end, deploy, weak]

describe('guardPick', () => {
  it('lets a pick within the margin stand', () => {
    expect(guardPick(menu, weak, 1)).toEqual({ item: weak, guard: null })
    expect(guardPick(menu, deploy, 1)).toEqual({ item: deploy, guard: null })
  })
  it('replaces a pick, a pass and END TURN that fall a margin or more below the best, recording the gap', () => {
    expect(guardPick(menu, end, 1)).toEqual({ item: deploy, guard: { picked: 1, taken: 2, gap: 2.5 } })
    expect(guardPick(menu, null, 1)).toEqual({ item: deploy, guard: { picked: null, taken: 2, gap: 2.5 } })
    expect(guardPick(menu, weak, 0.5)).toEqual({ item: deploy, guard: { picked: 3, taken: 2, gap: 0.7 } })
  })
  it('never guards at Infinity, and treats unscored items as zero', () => {
    expect(guardPick(menu, end, Infinity)).toEqual({ item: end, guard: null })
    expect(guardPick([end, { ...deploy, score: null }], null, 1)).toEqual({ item: null, guard: null })
  })
})
```

`telemetry.test.ts`: extend the mapping test's row with `guard: { picked: 1, taken: 2, gap: 2.5 }` and expect `guard` on the DB row; the null case maps `null`.

`llmPolicy.test.ts` (uses the file's `fakeClient` and menu helpers):

```ts
  it('plays the best move instead of a plan that ends the turn a margin below it, and files the guard', async () => {
    // A turn where a deploy scores well above END TURN; the model plans END TURN only.
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ship-100', materialCost: 100000 })], deck: [] } } })
    g.state.resources.b.materials = 225000
    const calls: LlmRequest[] = []
    const client = fakeClient([(() => JSON.stringify({ plan: [/* END TURN id, resolved from the menu in the fake */], expectation: { summary: 's', battle: null }, tableTalk: null }))()], calls)
    // Use the file's pattern for resolving ids from the shown menu (idOf on the last user message).
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(g, BOT, makeCtx(), policy)
    expect(applied[0].type).toBe('PLAY_CARD_TO_ZONE')
    expect(policy.rows[0].guard).toEqual(expect.objectContaining({ picked: expect.any(Number), taken: expect.any(Number) }))
    expect(policy.rows[0].guard!.gap).toBeGreaterThanOrEqual(1)
  })
  it('never guards with TEMPO_GUARD_TURNS at Infinity', async () => {
    // same game, settings { ...fast, tempoGuardTurns: Infinity } — the plan's END TURN is applied first
  })
```

Add `tempoGuardTurns?: number` and `menuScoreWindowTurns?: number` to `LlmPolicySettings` (defaulting to the llmSettings values) so a test and the eval can vary them without editing settings; `DEFAULT_LLM_POLICY_SETTINGS` carries both.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run shared/ai/llm/tempoGuard.test.ts shared/ai/llm/telemetry.test.ts shared/ai/llm/llmPolicy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// shared/ai/llm/tempoGuard.ts
import { TEMPO_GUARD_TURNS } from './llmSettings.ts'
import type { MenuItem } from './moveMenu.ts'

// The tempo guard (2026-09-19 scored menu spec §6.2): the model's pick — an
// item, or null for a pass / END TURN, both worth the position as it stands
// — against the best-scored item on the whole menu. A pick a margin or more
// below the best is replaced by the best, and the row says so.
export interface GuardRecord { picked: number | null; taken: number; gap: number }

export function guardPick(menu: MenuItem[], chosen: MenuItem | null, margin: number = TEMPO_GUARD_TURNS): { item: MenuItem | null; guard: GuardRecord | null } {
  if (!Number.isFinite(margin) || menu.length === 0) return { item: chosen, guard: null }
  const value = (m: MenuItem | null): number => m?.score ?? 0
  const best = menu.reduce((b, m) => (value(m) > value(b) ? m : b), menu[0])
  const gap = Math.round((value(best) - value(chosen)) * 10) / 10
  if (gap < margin || best === chosen) return { item: chosen, guard: null }
  return { item: best, guard: { picked: chosen?.id ?? null, taken: best.id, gap } }
}
```

`telemetry.ts`: add `guard: GuardRecord | null` to `TelemetryRow` (import the type from `./tempoGuard.ts`) and `guard: row.guard` to `toBotDecisionRow`; both policies' `row()` helpers set `guard: null`.

Migration `supabase/migrations/20260919120000_bot_decisions_guard.sql`:

```sql
-- Scored menu (docs/superpowers/specs/2026-09-19-scored-menu-design.md §7):
-- the tempo guard's record when it replaced the model's pick — the menu
-- number picked (null for a pass), the number played, and the gap in turns.
alter table public.bot_decisions add column guard jsonb;
```

`llmPolicy.ts` — in `candidates`, both places a plan head becomes the answer:

```ts
    const next = this.plan[0]
    if (next && this.planKind === kind && menu.some((m) => sameAction(m.action, next.action))) {
      return [this.guarded(menu, next, kind).action, ...(await this.fallback.candidates(view, kind))]
    }
    …
    this.plan = items
    this.planKind = kind
    return [this.guarded(menu, items[0], kind).action, ...(await this.fallback.candidates(view, kind))]
```

with:

```ts
  // The tempo guard on a turn move (spec §6.2): a guarded pick replaces the
  // plan — the board will change on a premise the plan did not hold.
  private guarded(menu: MenuItem[], chosen: MenuItem, kind: OwedKind): MenuItem {
    if (kind !== 'turn') return chosen
    const { item, guard } = guardPick(menu, chosen, this.settings.tempoGuardTurns ?? TEMPO_GUARD_TURNS)
    if (!guard || !item) return chosen
    if (this.currentRow) this.currentRow.guard = guard
    this.plan = [item]
    return item
  }
```

(`onAccepted` already treats `this.plan[0]` as the expected move, so the guarded item is accepted as the plan head and the talk is carried.)

Add `"ai/llm/tempoGuard.ts"` to both manifest lists after `"ai/llm/moveMenu.ts"`.

- [ ] **Step 4: Run the tests, tsc, sync**

Run: `npx vitest run shared/ai/llm`; `npx tsc -p tsconfig.json --noEmit`; `npm run functions:sync`; `npx vitest run supabase/seed/functionSharedSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared supabase
git commit -m "feat(ai): the tempo guard in the single flow; guard telemetry" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The tempo guard in the sectioned flow

Spec §6.2: a pick, a pass and END TURN are all guarded against the whole menu; a guarded move keeps the section pointer where it is.

**Files:**
- Modify: `shared/ai/llm/sectionedPolicy.ts`
- Test: `shared/ai/llm/sectionedPolicy.test.ts`

- [ ] **Step 1: Write the failing tests** (the file's `scripted` client and `turnGame`; `turnGame`'s Corsair deploy scores well above END TURN)

```ts
describe('SectionedLlmPolicy — the tempo guard', () => {
  it('plays the best move when the model passes DEPLOY with a big deploy on the table, staying in DEPLOY', async () => {
    const client = scripted([
      { pick: null, then: 'next' },                       // pass → guarded: Corsair deployed, still DEPLOY
      { pick: null, then: 'next' },                       // pass again → nothing left worth a margin → ACTIVATE skipped → FIGHT
      { pick: 'ATTACK THE BASE', then: 'next' },
      { pick: null, then: 'next' },                       // FINISH pass → END TURN
    ])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'ATTACK_ENEMY_BASE', 'END_TURN'])
    expect(policy.rows[0].guard).toEqual(expect.objectContaining({ picked: null }))
    expect(client.calls[1].messages[client.calls[1].messages.length - 1].content).toContain('SECTION: DEPLOY')
  })
  it('plays the best move instead of END TURN when the model skips to FINISH with the deploy unplayed', async () => {
    const client = scripted([
      { pick: null, then: 'next' },                       // DEPLOY pass → guarded deploy
      { pick: null, then: 'next' },                       // DEPLOY pass → on to FIGHT
      { pick: null, then: 'next' },                       // FIGHT pass → FINISH
      { pick: null, then: 'next' },                       // FINISH pass → END TURN guarded? the base attack is still on the menu
    ])
    // Build the expectations from the menu: after the deploy, ATTACK THE BASE (zone 1, the Marauder) scores above END TURN by ≥ 1 turn.
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toContain('ATTACK_ENEMY_BASE')
    expect(applied[applied.length - 1].type).toBe('END_TURN')
    expect(policy.rows.some((r) => r.guard !== null)).toBe(true)
  })
  it('lets every pick stand with the guard at Infinity', async () => {
    const client = scripted([{ pick: null, then: 'next' }, { pick: null, then: 'next' }, { pick: null, then: 'next' }])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', { ...fast, tempoGuardTurns: Infinity })
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['END_TURN'])
    expect(policy.rows.every((r) => r.guard === null)).toBe(true)
  })
})
```

The exact call sequences depend on what the guard leaves worth a margin after each move; run the tests, read the applied list and the rows, and pin the sequence the implementation produces — but the properties asserted (the guarded deploy, the guarded base attack, the Infinity case applying END TURN only) must hold as written.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run shared/ai/llm/sectionedPolicy.test.ts`
Expected: the guard tests FAIL (END TURN applied first, no guard on the rows).

- [ ] **Step 3: Implement**

In `sectionedPolicy.ts`:

```ts
import { guardPick } from './tempoGuard.ts'
import { TEMPO_GUARD_TURNS } from './llmSettings.ts'

  private margin(): number { return this.settings.tempoGuardTurns ?? TEMPO_GUARD_TURNS }
```

In `turnMove`, the plan-head branch:

```ts
      if (menu.some((m) => sameAction(m.action, head.action))) {
        this.plan.shift()
        const { item, guard } = guardPick(menu, head, this.margin())
        if (guard && item && this.planRow) { this.planRow.guard = guard; this.plan = [] }
        this.expected = (item ?? head).action
        this.expectedRow = this.planRow
        return [(item ?? head).action, ...(await this.fallback.candidates(view, 'turn'))]
      }
```

The pass branch:

```ts
      if (asked.items.length === 0) {
        this.pendingTalk = asked.row.tableTalk ?? this.pendingTalk
        const { item, guard } = guardPick(menu, null, this.margin())
        if (guard && item) {
          asked.row.guard = guard
          this.lastOutcome = null
          this.propose(item, asked.row, null)   // no then: the pointer stays here
          return [item.action, ...(await this.fallback.candidates(view, 'turn'))]
        }
        this.lastOutcome = `You chose nothing in ${section.toUpperCase()}.`
        if (section === 'finish') return this.endTurn(view, menu)
        section = advanceFrom(section)
        continue
      }
```

The pick branch:

```ts
      const { item, guard } = guardPick(menu, asked.items[0], this.margin())
      if (guard && item) {
        asked.row.guard = guard
        this.propose(item, asked.row, null)
        this.plan = []
        this.planRow = null
        return [item.action, ...(await this.fallback.candidates(view, 'turn'))]
      }
      this.propose(asked.items[0], asked.row, asked.answer.then)
```

`endTurn`:

```ts
  private async endTurn(view: BotView, menu: MenuItem[]): Promise<GameAction[]> {
    const end = menu.find((m) => m.action.type === 'END_TURN') ?? null
    const { item, guard } = guardPick(menu, end, this.margin())
    if (guard && item) {
      const last = this.rows[this.rows.length - 1]
      if (last) last.guard = guard
      this.propose(item, last ?? this.row(view, 'turn', this.section, null, menu.length, 0, null), null)
      return [item.action, ...(await this.fallback.candidates(view, 'turn'))]
    }
    this.expected = end ? end.action : null
    this.expectedRow = null
    this.pendingThen = null
    const tail = await this.fallback.candidates(view, 'turn')
    return end ? [end.action, ...tail] : tail
  }
```

`propose` must accept a row for the guarded END TURN case; if no row exists (a turn with no call yet cannot reach `endTurn`, but keep the fallback), the fresh row is pushed onto `this.rows` too.

`onAccepted`: a guarded move was proposed with `then: null`, so `pendingThen` is untouched and `advance` stays false — the next ask is the same section with the real outcome. Confirm the "a move with then:next in finish ends the turn with no further call" test still passes: that path goes through `endTurn`, whose guard only fires when something on the menu still scores a margin above END TURN.

- [ ] **Step 4: Run the tests and tsc**

Run: `npx vitest run shared/ai/llm/sectionedPolicy.test.ts shared/ai`; `npx tsc -p tsconfig.json --noEmit`
Expected: PASS. Then `npm run functions:sync` and the drift test.

- [ ] **Step 5: Commit**

```bash
git add shared supabase/functions
git commit -m "feat(ai): the tempo guard in the sectioned flow — picks, passes and END TURN" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The eval — `--flow scored`, `--opponent`, guard settings, the guard line; docs

Spec §8, §9, §10.2.

**Files:**
- Modify: `scripts/eval-bot.ts`
- Modify: `docs/claude/architecture.md` (a short "Evaluator and tempo guard" subsection under the PracticeAI material), `CLAUDE.md` (the `BOT_FLOW` sentence: `single`, `sections` (default), `scored`)

**Interfaces:**
- `npm run bot:eval -- … [--flow single|sections|scored] [--opponent heuristic|scored] [--guard 1|inf] [--window 2|inf]`

- [ ] **Step 1: Implement** (no unit test — the eval is never in CI; verify by running it with `--games 0` for the argument parsing and reading the summary line)

In `eval-bot.ts`:

```ts
import { scoredPolicy } from '../shared/ai/scoredPolicy.ts'
import { MENU_SCORE_WINDOW_TURNS, TEMPO_GUARD_TURNS } from '../shared/ai/llm/llmSettings.ts'

const flow = botFlowFor(arg('flow', 'sections'))
const opponentName = arg('opponent', 'heuristic')
if (opponentName !== 'heuristic' && opponentName !== 'scored') throw new Error(`--opponent must be heuristic or scored, not ${opponentName}`)
const opponent: BotPolicy = opponentName === 'scored' ? scoredPolicy : basicPolicy
const num = (raw: string, fallback: number): number => (raw === '' ? fallback : raw.toLowerCase() === 'inf' ? Infinity : Number(raw))
const settings = {
  ...DEFAULT_LLM_POLICY_SETTINGS,
  reasoningEffort: reasoningEffortFor(model, arg('reasoning', '')),
  routing: routingFor(model, arg('providers', '')),
  tempoGuardTurns: num(arg('guard', ''), TEMPO_GUARD_TURNS),
  menuScoreWindowTurns: num(arg('window', ''), MENU_SCORE_WINDOW_TURNS),
}
```

The model side's policy per request:

```ts
    const modelPolicy: ModelBackedPolicy | null = side === modelSide
      ? (flow === 'scored' ? { ...scoredPolicy, rows: [], modelId: 'scored', settings }
        : flow === 'single' ? new LlmPolicy(client, scoredPolicy, model, settings) : new SectionedLlmPolicy(client, scoredPolicy, model, settings))
      : null
    const policy: BotPolicy = modelPolicy ?? opponent
```

Skip the client construction and the key check when `flow === 'scored'` (`const key = flow === 'scored' ? 'unused' : envValue(...)`). Summary line: include `opponent ${opponentName}, guard ${settings.tempoGuardTurns}, window ${settings.menuScoreWindowTurns}`. After the fallback line:

```ts
const turnRows = allRows.filter((r) => r.kind === 'turn')
const guarded = turnRows.filter((r) => r.guard !== null)
console.log(`tempo guard: fired on ${guarded.length} of ${turnRows.length} turn rows${guarded.length ? ` (mean gap ${(guarded.reduce((s, r) => s + r.guard!.gap, 0) / guarded.length).toFixed(1)} turns)` : ''}`)
```

Update the header comment's usage line. Note the window setting must reach `numberedMenu`/`buildUserPrompt`: both policies pass `this.settings.menuScoreWindowTurns ?? MENU_SCORE_WINDOW_TURNS` through (`numberedMenu(menu, section, window)`; `buildUserPrompt({ …, window })` — add `window?: number` to `PromptInput` and use it in place of the default). Add that plumbing here if Task 6 left the defaults hard-wired.

- [ ] **Step 2: Verify the parsing**

Run: `npx tsx scripts/eval-bot.ts --games 0 --flow scored` (needs no key) and `npx tsx scripts/eval-bot.ts --games 0 --opponent nobody`
Expected: the first prints a summary with `0/0`; the second throws the `--opponent` message.

- [ ] **Step 3: Docs**

`docs/claude/architecture.md`: after the PracticeAI menu paragraph, add:

> **Evaluator and tempo guard (2026-09-19).** `shared/ai/evaluator.ts` scores a position in turns of tempo (turns the enemy needs to fell the bot's second base minus the bot's, plus board/hand/base-HP terms) and `scoreMove` scores a move by trial-applying it, settling choices, sampling a fleet attack through `battleSim.ts`, ending the turn and scoring. `buildMenu` attaches the delta against END TURN to every turn item (`MenuItem.score`); the model reads it as `[+2.4]`. `tempoGuard.ts`'s `guardPick` replaces a pick, a pass or END TURN that sits `TEMPO_GUARD_TURNS` or more below the best item and files `guard` on the row. `scoredPolicy` plays the best item — `BOT_FLOW=scored`, and the fallback inside both model flows. Spec: `docs/superpowers/specs/2026-09-19-scored-menu-design.md`.

`CLAUDE.md`: change the `BOT_FLOW=single` sentence to name all three flows and the fallback:

> `BOT_FLOW=single` restores the single-shot planning policy and `BOT_FLOW=scored` plays the tempo evaluator with no model; the default is the sectioned conversation. When a call fails or no key is set, the evaluator plays, not the heuristic.

- [ ] **Step 4: Full gates**

Run: `npx vitest run`; `npx tsc -p tsconfig.json --noEmit`; `npm run functions:check`; `npm --prefix frontend run build` (the frontend imports `shared/` types — a `MenuItem` change could reach it)
Expected: all green; report the before → after test count.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-bot.ts docs/claude/architecture.md CLAUDE.md
git commit -m "feat(eval): --flow scored, --opponent, --guard, --window; the guard line; docs" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec §3 → Tasks 2–3; §4 → Task 4; §5, §6.4 → Task 5; §6.1, §6.3, §8 → Task 6; §6.2, §7 → Tasks 7–8; §8 (eval flags), §9 docs, §10.2 → Task 9. §10.2's eval matrix runs outside the plan.
- `score` is added to `MenuItem` in Task 4; every later task's `MenuItem` literal carries it. `guard` is added to `TelemetryRow` in Task 7; Task 8 reads it. `tempoGuardTurns` / `menuScoreWindowTurns` on `LlmPolicySettings` are introduced in Task 7 and used in Tasks 8–9 — Task 6's renderers take a `window` argument so Task 9 can plumb the setting.
- The import graph after Task 1: `moveMenu → evaluator → {botOwes, basicPolicy, botView, battleSim}`; none of those import the menu or the driver; `scoredPolicy → basicPolicy` and a type-only `MenuItem`.
