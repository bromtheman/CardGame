# Phase 6 — Polish (Theme, Reconnect, My Games, Concede/Abandon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the spec's Polish phase: reconnect-robust realtime, a real My Games dashboard with abandon handling, themed dialogs replacing native ones, the exact spec gradient plus small theme touches, and route-level code splitting.

**Architecture:** One new engine action (`ABANDON` — the off-turn walk-away that marks a game `abandoned` with the opponent as winner) is the only rules change; everything else is frontend. The realtime layer gains a pure, unit-tested reconnect policy module (backoff + wake decisions) driven by a rewritten `useRealtimeInvalidate` that handles channel status, browser online/visibility events, and missed-event catch-up. A reusable themed `ConfirmDialog`/`PromptDialog` pair replaces every `window.confirm`/`window.prompt`.

**Tech Stack:** TypeScript strict, Vitest (root config), React 19 + react-router (React.lazy/Suspense), Tailwind v4 tokens, supabase-js realtime channels, TanStack Query v5.

**Spec:** `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` — §3.6 winning, §5 action vocabulary, §6 realtime ("Reconnect = resubscribe + refetch; A My Games page lists active games with a your-turn indicator"), §7 theme ("deep navy gradient background rgb(21,56,112)→rgb(14,41,84)"), §9 phase "Polish — theme pass, reconnect robustness, My Games dashboard, concede/abandon handling". §10 keeps turn timers OUT of scope — abandon is a voluntary action, never a timeout.

## Global Constraints

- **Run all commands from repo root** `C:\Users\JFinn\FtDCardGame`, branch `phase-6-polish` (created from `main` before Task 1).
- Full test suite: `npx vitest run` (root config; `passWithNoTests` is false). Filtered runs use path filters, e.g. `npx vitest run shared/engine/gameEngine` or `npx vitest run frontend/src/lib`. NEVER `--root` (breaks include globs). "No test files found" = wrong command, never a pass.
- Typecheck: `npx tsc -p tsconfig.json --noEmit` (there is no shared/tsconfig.json). Frontend: `npm --prefix frontend run build`.
- `.ts` extensions on all relative imports inside `shared/`.
- **Any task modifying `shared/` runs `npm run functions:sync` before committing and commits the synced copies** (drift test enforces byte equality). Engine core files (`gameEngine.ts`, `engineTypes.ts`) sync into game-action ONLY (lobby-action's manifest carries just gameSettings/types/lobbySettings/deckValidation/gameInit) — so the ABANDON change requires redeploying game-action only.
- Engine invariants: consumers import `shared/engine/index.ts`; all success paths funnel through `applyAction`'s `finish()` log-trim; handlers/actions validate before mutating; `structuredClone` guarantees atomicity; public `state.log` must never name hidden hand cards.
- Frontend tests added this phase must be PURE NODE tests (no DOM, no React imports) — the vitest root config gains `frontend/src/**/*.test.ts` in its include, with no jsdom environment.
- The server is authoritative; frontend legality/cost displays are advisory.
- Supabase project ref `wpgsjnjnvykxavaxibld`; deploys via MCP `deploy_edge_function` with `verify_jwt: false` (functions do their own auth). Deploy and live-E2E tasks are CONTROLLER-RUN (established Phase 4/5 precedent).
- Commit trailer (exact): `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Rulings already made** (do not re-litigate):
  - **ABANDON semantics:** a voluntary, off-turn-capable, battle-capable action (`{ type: 'ABANDON' }`, in BOTH `BATTLE_ACTIONS` and `OFF_TURN_ACTIONS`, dispatched top-level like CONCEDE). Effect: `status = 'abandoned'`, `winnerId` = the other player, log `Player X abandoned the battle`. CONCEDE keeps its current semantics (`status = 'complete'`). No timers, no staleness rules (spec §10).
  - **Body gradient matches the spec exactly**: `linear-gradient(180deg, #153870, #0e2954)` — i.e. tokens `ocean-800 → ocean-900` (the current bottom stop `ocean-950` is a deviation and gets fixed).
  - Reconnect backoff: base 1000ms, doubling, capped at 30_000ms, attempt counter reset on SUBSCRIBED. On (re)SUBSCRIBED the hook invalidates its query keys (missed-event catch-up). On browser `online`/visible wake: if the channel is not joined → reconnect; if joined → just invalidate (cheap catch-up).
  - Intentional teardown must not trigger reconnects: each connect attempt carries a generation token; callbacks from superseded channels are ignored (this is the subtle bug to avoid — `removeChannel` fires the old channel's `CLOSED`).
  - Native dialogs (3× `window.confirm`, 1× `window.prompt`) are replaced by ONE reusable themed dialog pair; no new dialog library.
  - The empty worktree `.claude/worktrees/decks-screen-improvements-d98815` (branch `claude/decks-screen-improvements-d98815`, zero commits past its fork) belongs to another session — do not touch, remove, or build on it.

## File Structure

- `shared/engine/engineTypes.ts`, `shared/engine/gameEngine.ts` — MODIFY: ABANDON action (Task 1).
- `frontend/src/lib/reconnectPolicy.ts` + `frontend/src/lib/reconnectPolicy.test.ts` — NEW: pure backoff/decision logic (Task 2).
- `frontend/src/lib/realtime.ts` — REWRITE: status-aware, self-healing hook (Task 2).
- `frontend/src/main.tsx` — MODIFY: QueryClient defaults (Task 2).
- `vitest.config.ts` — MODIFY: include `frontend/src/**/*.test.ts` (Task 2).
- `frontend/src/components/ConfirmDialog.tsx` — NEW: themed confirm + prompt dialogs (Task 3).
- `frontend/src/pages/DecksPage.tsx`, `frontend/src/pages/game/GameBoardPage.tsx`, `frontend/src/pages/game/HandBar.tsx`, `frontend/src/pages/game/HeroPowerBar.tsx` — MODIFY: dialog replacement (Task 3).
- `frontend/src/lib/time.ts` — NEW: `timeAgo` (Task 4).
- `frontend/src/pages/GamesPage.tsx`, `frontend/src/pages/HomePage.tsx`, `frontend/src/lib/games.ts` — MODIFY: dashboard + abandon + home quick links (Task 4).
- `frontend/src/pages/game/GameBoardPage.tsx` — MODIFY: 'abandoned' end-state (Task 5). `frontend/src/theme/index.css` — MODIFY: gradient (Task 5). GameBoardPage resource strip — materials icon (Task 5).
- `frontend/src/App.tsx` — MODIFY: lazy routes (Task 6).
- `supabase/functions/game-action/*` — synced + deployed v5 (Task 7).
- `docs/superpowers/specs/2026-08-24-ftd-card-game-design.md` — MODIFY: §3.6/§5 abandon (Task 9).

---

### Task 1: Engine — the ABANDON action

**Files:**
- Modify: `shared/engine/engineTypes.ts` (GameAction union), `shared/engine/gameEngine.ts`
- Test: `shared/engine/gameEngine.test.ts` (append)

**Interfaces:**
- Consumes: existing `concede` pattern in gameEngine.ts (top-level dispatch before the handler map), `BATTLE_ACTIONS`/`OFF_TURN_ACTIONS` sets, fixtures `makeGame`/`makeCtx`.
- Produces: `{ type: 'ABANDON' }` in the `GameAction` union; applyAction handles it top-level. Later tasks send it from the UI and E2E.

- [ ] **Step 1: Write the failing tests** (append to `shared/engine/gameEngine.test.ts`):

```ts
describe('ABANDON', () => {
  it('lets the OFF-TURN player abandon: status abandoned, opponent wins, log line', () => {
    const game = makeGame() // activePlayer 'alice' (side a)
    const r = applyAction(game, 'bob', { type: 'ABANDON' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.game.status).toBe('abandoned')
    expect(r.game.winnerId).toBe('alice')
    expect(r.game.state.log).toContain('Player B abandoned the battle')
  })
  it('works for the active player too, and during a frozen battle', () => {
    const game = makeGame()
    game.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [], defenderIds: [],
      distanceM: 1200, distanceModifiedBy: [],
    }
    const r = applyAction(game, 'alice', { type: 'ABANDON' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.game.status).toBe('abandoned')
    expect(r.game.winnerId).toBe('bob')
  })
  it('rejects abandoning a finished game', () => {
    const game = makeGame({ status: 'complete', winnerId: 'alice' })
    const r = applyAction(game, 'bob', { type: 'ABANDON' })
    expect(r).toEqual({ ok: false, status: 409, error: 'Game is over' })
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run shared/engine/gameEngine`. Expected RED shape (applyAction's generic guards run BEFORE the handler-map miss): test 1 fails with 409 `'Not your turn'` (ABANDON not yet in OFF_TURN_ACTIONS), test 2 fails with 409 `'A battle is in progress — resolve it first'` (not yet in BATTLE_ACTIONS). Test 3 PASSES from the start — it pins the existing `status !== 'active'` guard; that is expected and fine.

- [ ] **Step 3: Implement.**
  - `engineTypes.ts`: add `| { type: 'ABANDON' }` to `GameAction` (beside CONCEDE).
  - `gameEngine.ts`: add `'ABANDON'` to BOTH `BATTLE_ACTIONS` and `OFF_TURN_ACTIONS`; add beside `concede`:

```ts
// Walking away from an unfinished game — same loss as conceding, but the
// game is marked abandoned so My Games can tell the two apart.
function abandon(game: EngineGame, actor: Side): ApplyResult {
  game.status = 'abandoned'
  game.winnerId = actor === 'a' ? game.playerB : game.playerA
  game.state.log.push(`Player ${actor.toUpperCase()} abandoned the battle`)
  return { ok: true, game }
}
```

  and in `applyAction`, beside the CONCEDE line: `if (action.type === 'ABANDON') return finish(abandon(game, actor))`.

- [ ] **Step 4: Run to verify green** — `npx vitest run shared/engine/gameEngine`, then `npm run functions:sync`, full `npx vitest run`, `npx tsc -p tsconfig.json --noEmit`, `npm --prefix frontend run build`.

- [ ] **Step 5: Commit** — `feat(engine): ABANDON marks a walked-away game with the opponent as winner` (include synced copies).

### Task 2: Reconnect robustness

**Files:**
- Create: `frontend/src/lib/reconnectPolicy.ts`, `frontend/src/lib/reconnectPolicy.test.ts`
- Modify: `frontend/src/lib/realtime.ts` (rewrite), `frontend/src/main.tsx`, `vitest.config.ts`

**Interfaces:**
- Consumes: existing `useRealtimeInvalidate(channelKey, table, queryKeys, filter?)` call sites — ALL FIVE: GamesPage.tsx:13, LobbiesPage.tsx:62 ('lobbies-browser'), LobbiesPage.tsx:63 ('lobbies-games'), GameBoardPage.tsx:25, GameBoardPage.tsx:26 — the hook's SIGNATURE MUST NOT CHANGE (verify all five compile untouched).
- Produces: `backoffDelayMs(attempt: number): number`, `actionForStatus(status: string): 'settled' | 'reconnect' | 'ignore'`, `wakeAction(channelState: string): 'reconnect' | 'refetch'`, constants `BACKOFF_BASE_MS = 1000`, `BACKOFF_CAP_MS = 30_000` — all exported from `reconnectPolicy.ts`.

- [ ] **Step 1: Extend vitest include.** In `vitest.config.ts`, add `'frontend/src/**/*.test.ts'` to the `include` array (tests there must stay pure-node — no DOM/React imports).

- [ ] **Step 2: Write the failing tests** — `frontend/src/lib/reconnectPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  actionForStatus, backoffDelayMs, BACKOFF_BASE_MS, BACKOFF_CAP_MS, wakeAction,
} from './reconnectPolicy'

describe('backoffDelayMs', () => {
  it('doubles from the base and caps', () => {
    expect(backoffDelayMs(0)).toBe(BACKOFF_BASE_MS)
    expect(backoffDelayMs(1)).toBe(2000)
    expect(backoffDelayMs(3)).toBe(8000)
    expect(backoffDelayMs(10)).toBe(BACKOFF_CAP_MS)
  })
})

describe('actionForStatus', () => {
  it('maps channel lifecycle statuses to hook actions', () => {
    expect(actionForStatus('SUBSCRIBED')).toBe('settled')
    expect(actionForStatus('CHANNEL_ERROR')).toBe('reconnect')
    expect(actionForStatus('TIMED_OUT')).toBe('reconnect')
    expect(actionForStatus('CLOSED')).toBe('reconnect')
    expect(actionForStatus('anything-else')).toBe('ignore')
  })
})

describe('wakeAction', () => {
  it('reconnects only when the channel is not joined', () => {
    expect(wakeAction('joined')).toBe('refetch')
    expect(wakeAction('closed')).toBe('reconnect')
    expect(wakeAction('errored')).toBe('reconnect')
    expect(wakeAction('joining')).toBe('reconnect')
  })
})
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run frontend/src/lib` → FAIL (module not found).

- [ ] **Step 4: Implement `reconnectPolicy.ts`:**

```ts
// Pure decisions for the realtime reconnect loop — kept free of supabase and
// React so they can be unit-tested (the hook in realtime.ts is the only I/O).
export const BACKOFF_BASE_MS = 1000
export const BACKOFF_CAP_MS = 30_000

export function backoffDelayMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS)
}

export function actionForStatus(status: string): 'settled' | 'reconnect' | 'ignore' {
  if (status === 'SUBSCRIBED') return 'settled'
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') return 'reconnect'
  return 'ignore'
}

// After the tab wakes (online / visibilitychange): a joined channel only
// needs a catch-up refetch; anything else needs a fresh subscription.
export function wakeAction(channelState: string): 'reconnect' | 'refetch' {
  return channelState === 'joined' ? 'refetch' : 'reconnect'
}
```

- [ ] **Step 5: Rewrite `realtime.ts`** (same exported signature):

```ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { actionForStatus, backoffDelayMs, wakeAction } from './reconnectPolicy'

// Subscribes to postgres_changes and invalidates the given query keys on any
// event. Self-healing (spec §6: reconnect = resubscribe + refetch): channel
// errors trigger backoff resubscribes, a (re)join refetches to catch missed
// events, and waking the tab (online / visible) checks the channel and
// refetches. Each connect attempt carries a generation token so callbacks
// from a superseded channel (removeChannel fires its CLOSED) are ignored.
export function useRealtimeInvalidate(
  channelKey: string,
  table: string,
  queryKeys: unknown[][],
  filter?: string,
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    let disposed = false
    let generation = 0
    let attempt = 0
    let timer: number | undefined
    let channel: RealtimeChannel | null = null

    const invalidateAll = () => {
      for (const key of queryKeys) queryClient.invalidateQueries({ queryKey: key })
    }

    const connect = () => {
      if (disposed) return
      // An out-of-band reconnect (wake) supersedes any scheduled retry.
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
      const mine = ++generation
      if (channel) supabase.removeChannel(channel)
      channel = supabase
        .channel(channelKey)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
          invalidateAll,
        )
        .subscribe((status) => {
          if (disposed || mine !== generation) return
          const action = actionForStatus(status)
          if (action === 'settled') {
            attempt = 0
            invalidateAll()
          } else if (action === 'reconnect' && timer === undefined) {
            timer = window.setTimeout(() => {
              timer = undefined
              connect()
            }, backoffDelayMs(attempt++))
          }
        })
    }

    const onWake = () => {
      if (disposed || document.visibilityState === 'hidden') return
      if (wakeAction(channel?.state ?? 'closed') === 'reconnect') connect()
      else invalidateAll()
    }

    connect()
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
      if (channel) supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, table, filter, queryClient])
}
```

- [ ] **Step 6: QueryClient defaults** in `frontend/src/main.tsx`:

```ts
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnReconnect: 'always', retry: 2 } },
})
```

- [ ] **Step 7: Run** — `npx vitest run frontend/src/lib` green, full `npx vitest run` green, `npx tsc -p tsconfig.json --noEmit`, `npm --prefix frontend run build` clean. (No shared/ changes — no sync needed.)

- [ ] **Step 8: Commit** — `feat(realtime): self-healing subscriptions with backoff and wake catch-up`

### Task 3: Themed dialogs replace native ones

**Files:**
- Create: `frontend/src/components/ConfirmDialog.tsx`
- Modify: `frontend/src/pages/DecksPage.tsx` (~line 35), `frontend/src/pages/game/GameBoardPage.tsx` (~line 137 concede), `frontend/src/pages/game/HandBar.tsx` (~line 126 no-effect confirm), `frontend/src/pages/game/HeroPowerBar.tsx` (~line 113 distance prompt)

**Interfaces:**
- Produces (Task 4 reuses these): two components exported from `ConfirmDialog.tsx`. NOTE: write NO return-type annotations (codebase style — and the bare global `JSX.Element` does not exist under this project's React 19 types; TS infers the return):

```tsx
export function ConfirmDialog(props: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  danger?: boolean            // red confirm button when true
  onConfirm: () => void
  onCancel: () => void
})

export function PromptDialog(props: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  inputType?: 'number'
  placeholder?: string
  onConfirm: (value: string) => void
  onCancel: () => void
})
```

Both render `null` when `!open`; otherwise a `fixed inset-0 z-50` overlay (`bg-ocean-950/80`) centering a panel styled like the existing victory modal (`rounded border border-brass-400 bg-ocean-900 p-6 shadow-plank`), `font-display` title, body in `text-ocean-300`, Cancel (`border border-ocean-600`) + Confirm (brass, or `bg-red-700 text-parchment-100` when `danger`). Clicking the backdrop cancels; Escape cancels (a `keydown` listener while open). PromptDialog keeps local input state, passes the raw string to `onConfirm`.

- [ ] **Step 1: Implement the two components** per the interface above (this is presentational code — no unit tests; the gates are typecheck + build + the existing suite staying green).
- [ ] **Step 2: Replace the four native dialogs.** Each call site keeps its behavior but swaps the mechanism (a small `useState` holding the pending action/dialog-open flag per page):
  - DecksPage scuttle: `ConfirmDialog` title "Scuttle this deck?", body includes the deck name, danger, confirm "Scuttle".
  - GameBoardPage concede: title "Strike your colors?", body "Conceding ends the battle immediately — your opponent takes the win.", danger, confirm "Concede".
  - HandBar no-effect ability: title "Play {name}?", body "It has no effect — this only spends the card.", confirm "Play it".
  - HeroPowerBar tactical distance: `PromptDialog` with `inputType: 'number'`, title "Tactical Positioning", body \`Adjust the active battle's spawn distance by up to ±${HERO_POWER_DISTANCE_MOD_M}m.\`, confirm "Adjust"; parse + clamp exactly as the old prompt handler did (Number, NaN→0, clamp ±HERO_POWER_DISTANCE_MOD_M, 0 → no-op).
- [ ] **Step 3: Verify no native dialogs remain** — `grep -rn "window.confirm\|window.prompt\|window.alert" frontend/src` → no matches.
- [ ] **Step 4: Gates** — full `npx vitest run`, tsc, frontend build.
- [ ] **Step 5: Commit** — `feat(ui): themed confirm and prompt dialogs replace native ones`

### Task 4: My Games dashboard + abandon + Home quick links

**Files:**
- Create: `frontend/src/lib/time.ts`
- Modify: `frontend/src/pages/GamesPage.tsx`, `frontend/src/pages/HomePage.tsx`, `frontend/src/lib/games.ts` (gains the exported `isMyMove` helper; the existing `useGamesQuery` already returns all games ordered by `updated_at desc`)

**Interfaces:**
- Consumes: `ConfirmDialog` (Task 3), `{ type: 'ABANDON' }` (Task 1), the direct `supabase.functions.invoke('game-action', …)` path (Step 3 spells it out — `useGameActions` is deliberately NOT reused here), `useGamesQuery`'s `select('*')` rows (they include `version`, `state`, `updated_at`).
- Produces: `timeAgo(iso: string, nowMs?: number): string` in `frontend/src/lib/time.ts` — "just now" (<60s), "Nm ago", "Nh ago", "Nd ago"; `isMyMove(g, me): boolean` exported from `frontend/src/lib/games.ts` (Step 3).

- [ ] **Step 1: `timeAgo` test first** — `frontend/src/lib/time.test.ts` (pure node):

```ts
import { describe, expect, it } from 'vitest'
import { timeAgo } from './time'

describe('timeAgo', () => {
  const now = new Date('2026-08-25T12:00:00Z').getTime()
  it('buckets seconds, minutes, hours, days', () => {
    expect(timeAgo('2026-08-25T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-08-25T11:45:00Z', now)).toBe('15m ago')
    expect(timeAgo('2026-08-25T07:00:00Z', now)).toBe('5h ago')
    expect(timeAgo('2026-08-22T12:00:00Z', now)).toBe('3d ago')
  })
})
```

  Implementation: `export function timeAgo(iso: string, nowMs: number = Date.now()): string` with 60s/3600s/86400s buckets (floor division).
- [ ] **Step 2: Run RED, implement, run GREEN** — `npx vitest run frontend/src/lib`.
- [ ] **Step 3: Rebuild GamesPage as the dashboard.** Three sections in order, each only rendered when non-empty, from the one `useGamesQuery()` result. **The "your move" classifier must account for battle-frozen states, where the OFF-turn player is the one with a pending decision** (the row's `state` jsonb carries what's needed). Implement it as a small exported helper in `frontend/src/lib/games.ts` so the Home banner reuses it:

```ts
// True when this game is waiting on ME: my normal turn, a stealthy-withdrawal
// response I owe as defender, or a battle report awaiting MY approval.
export function isMyMove(g: {
  active_player: string
  player_a: string
  state: { awaitingResponse: { aggressor: 'a' | 'b' } | null; pendingReport: { submittedBy: 'a' | 'b' } | null }
}, me: string): boolean {
  const mySide: 'a' | 'b' = g.player_a === me ? 'a' : 'b'
  if (g.state?.pendingReport) return g.state.pendingReport.submittedBy !== mySide
  if (g.state?.awaitingResponse) return g.state.awaitingResponse.aggressor !== mySide
  return g.active_player === me
}
```

  - **"Your move"** — active games where `isMyMove(g, me)`; brass-accented rows.
  - **"Waiting on the enemy"** — the other active games.
  - **"Concluded"** — `status !== 'active'`, with a result badge: `Victory` (brass) / `Defeat` (red-400) via `winner_id === me`, and label `Abandoned` styled `text-ocean-300` when `status === 'abandoned'` (still paired with Victory/Defeat coloring).
  Every row: opponent username (existing `useUsernames`), `turn {g.turn_number}`, `timeAgo(g.updated_at)`, link to `/game/${g.id}`. Active rows additionally get an **Abandon ship** button. RESTRUCTURE the row so the button is a SIBLING of the Link, not inside it (the whole row is currently the anchor — a button inside it would hard-navigate even with stopPropagation): `<li className="flex items-center gap-2"><Link className="flex-1 …" …>…</Link><button …>Abandon ship</button></li>`; give the button `onClick={(e) => { e.preventDefault(); e.stopPropagation(); … }}` anyway as belt-and-braces. The button opens `ConfirmDialog` (danger, title "Abandon ship?", body "Walking away hands {opponent} the victory. The battle will be recorded as abandoned.", confirm "Abandon"). On confirm, use the DIRECT invoke path (do NOT reuse `useGameActions` — it binds one gameId/version per hook call and would be a hooks-in-a-loop trap here; add the `supabase` import to GamesPage): `supabase.functions.invoke('game-action', { body: { gameId: g.id, expectedVersion: g.version, action: { type: 'ABANDON' } } })`, then `queryClient.invalidateQueries({ queryKey: ['games'] })`. Surface failures inline (small red text line under the row): parse them the way `useGameActions.ts` does — `if (error instanceof FunctionsHttpError)` → `const body = await error.context.json().catch(() => null)` → `body?.errors?.join('; ') ?? error.message` (the function returns `{ errors: string[] }`).
  - Keep the existing realtime subscription line as-is.
- [ ] **Step 4: Home quick links.** HomePage gains, under the existing welcome copy: a 2×2 grid of themed link cards (Harbor `/lobbies`, My Games `/games`, Decks `/decks`, Cards `/cards`) using the plank/brass styling of existing panels, and — when the games query reports N active games where `isMyMove(g, me)` — a brass banner "N battle(s) await your orders" linking to `/games` (reuse `useGamesQuery` + the `isMyMove` helper; render nothing while loading).
- [ ] **Step 5: Gates** — full suite, tsc, frontend build.
- [ ] **Step 6: Commit** — `feat(ui): My Games dashboard with abandon, and a Home worth docking at`

### Task 5: Board end-states + theme pass

**Files:**
- Modify: `frontend/src/pages/game/GameBoardPage.tsx` (end-state overlay ~lines 300-311, resource strip ~line 193), `frontend/src/theme/index.css` (body gradient)

- [ ] **Step 1: End-state overlay covers 'abandoned'.** The existing `status === 'complete'` overlay condition becomes `status !== 'active'`. ALSO gate the battle surfaces on the game being live: render `BattleOverlay` and `StealthyResponseBar` only when `game.status === 'active'` — an abandoned/conceded mid-battle game leaves `state.activeBattle`/`pendingReport` set, and BattleOverlay's only current gate is `if (!battle) return null` with the same `z-50` as the end-state overlay (today the end-state wins purely by DOM order — make it explicit). Heading logic:
  - complete + I won → "Victory!" (existing)
  - complete + opponent won → "{opponent} wins" (existing)
  - abandoned + I won → "{opponent} abandoned ship — the day is yours"
  - abandoned + opponent won → "You abandoned the battle"
  Keep the "Back to battles" link.
- [ ] **Step 2: Spec gradient.** In `frontend/src/theme/index.css`, change the body background to `linear-gradient(180deg, var(--color-ocean-800), var(--color-ocean-900))` (spec §7: rgb(21,56,112)→rgb(14,41,84); the current bottom stop uses ocean-950 and is a deviation).
- [ ] **Step 3: Materials icon.** In GameBoardPage's resource indicator, render `ironSVG` (import from `../../assets/icons/ironSVG.svg`, same pattern as MiniVehicle's icon imports) as a 16px img with `alt="materials"` before the materials value. CP display stays text.
- [ ] **Step 4: Gates** — full suite, tsc, frontend build.
- [ ] **Step 5: Commit** — `feat(ui): abandoned end-state, spec gradient, materials icon`

### Task 6: Route-level code splitting

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Lazy-load every page component** (`const HomePage = lazy(() => import('./pages/HomePage'))` etc. — pages export default? CHECK: if pages use named exports, use `lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })))`). Wrap the `<Routes>` in `<Suspense fallback={...}>` with a themed fallback (`<main className="p-12 text-center font-display text-2xl text-ocean-300">Charting a course…</main>`).
- [ ] **Step 2: Build and record chunk sizes** — `npm --prefix frontend run build`; the previous single-bundle >500kB warning should be gone (largest chunk under the 500kB warning threshold). Paste the output chunk table into the report. If a chunk still exceeds 500kB, note WHICH and why (do not chase further splitting — report it).
- [ ] **Step 3: Gates** — full suite, tsc.
- [ ] **Step 4: Commit** — `perf(ui): route-level code splitting`

### Task 7: Deploy game-action v5 (CONTROLLER-RUN)

- [ ] **Step 1:** `npm run functions:sync` (should be a no-op if Task 1 committed synced copies — verify), `npx vitest run supabase/seed` (drift green), full suite green.
- [ ] **Step 2:** Deploy `game-action` via MCP `deploy_edge_function` (project `wpgsjnjnvykxavaxibld`, `verify_jwt: false`, full synced file set incl. the ABANDON engine files). Verify version increments and status ACTIVE; `get_advisors` security shows only the 3 known by-design WARNs.
- [ ] **Step 3:** Commit any stray changes (normally none — Task 1 already committed).

### Task 8: Live smoke — abandon over the wire (CONTROLLER-RUN)

Reuse the Phase 5 E2E scaffolding (session scratchpad `e2e-phase5.ts` helpers: signIn, invokeFn, deck/lobby/start). Script (not committed):
- [ ] Create a fresh game between the two test accounts (any two valid decks).
- [ ] The NON-active player sends `{ type: 'ABANDON' }` → 200.
- [ ] Assert: `status === 'abandoned'`, `winner_id` = the active player, log contains `abandoned the battle`.
- [ ] Sending any further action → 409 'Game is over'.
- [ ] Quick regression: one PLAY_CARD_TO_ZONE in a second fresh game still works (engine registry intact after redeploy).
- [ ] Report the assertion tally.

### Task 9: Spec amendments (CONTROLLER-RUN, doc-only)

- [ ] §3.6 Winning: append — "A player may also **abandon** an unfinished game at any time (even off-turn or mid-battle); the game is marked `abandoned` and the opponent takes the win. There are no inactivity timeouts (§10)."
- [ ] §5 game-action vocabulary: add `ABANDON` to the action list.
- [ ] Commit — `docs(spec): abandon action and semantics`

## Self-Review (performed)

1. **Spec coverage:** §9 Polish — theme pass (Task 5: gradient to exact spec colors, materials icon; survey confirmed the rest of §7's theme targets already shipped in Phases 1–5: Lobster, parchment, 20 icons, 280×430, shortHandNumber), reconnect robustness (Task 2 implements §6's "resubscribe + refetch" literally), My Games dashboard (Task 4; §6's your-turn indicator kept and extended), concede/abandon handling (concede existed — Task 3 themes its confirm; abandon: Tasks 1/4/5/7/8/9). §10 respected: no timers. Code splitting folds in the standing backlog item.
2. **Placeholder scan:** none — every code step carries real code; Task 3's components are fully interface-specified; Task 6 includes the named-export fallback pattern.
3. **Type consistency:** `timeAgo(iso, nowMs?)` defined Task 4 and used only there; `ConfirmDialog`/`PromptDialog` props defined Task 3, consumed Task 4; `ABANDON` defined Task 1, consumed Tasks 4/8/9; `backoffDelayMs`/`actionForStatus`/`wakeAction` defined and consumed within Task 2; hook signature unchanged so Task 2 breaks no call sites.
