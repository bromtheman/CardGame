# Frontend — conventions and sharp edges

Read this before changing pages, realtime behavior, dialogs, or query wiring.
Stack: Vite + React 19 + TypeScript strict + Tailwind v4 (CSS-first tokens in
`src/theme/index.css`) + TanStack Query v5 + supabase-js v2 + react-router v7.

## Conventions

- **No return-type annotations on components.** React 19's types removed the
  global `JSX` namespace — bare `JSX.Element` does not compile here. Let TS infer.
- All routes are lazy: `App.tsx` uses
  `lazy(() => import('./pages/X').then((m) => ({ default: m.X })))` — pages are
  **named exports**; keep new pages consistent and add them the same way.
- Theming via Tailwind v4 `@theme` tokens (`--color-ocean-*`, brass, etc.) in
  `src/theme/index.css`; the body gradient is spec-exact — change only with a
  spec amendment.
- Env: `frontend/.env.local` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
  (anon/publishable key ONLY — never a secret key).
- Dialogs: use `ConfirmDialog` / `PromptDialog` from
  `src/components/ConfirmDialog.tsx`. Native `window.confirm/prompt/alert` are
  banned (all removed in Phase 6).
- Card faces: `PhysicalCard` (collection/hand) and `MiniVehicle` (in-zone) each
  own a Details affordance that opens `CardDetailsModal` — a full-screen blow-up
  plus the keyword/vehicle-type glossary from `src/lib/keywords.ts`. On
  `PhysicalCard` that affordance depends on whether the call site claimed the
  click: without `onClick` the face itself opens the modal, with `onClick`
  (playing a vehicle from hand) a corner "Details" button carries it instead.
  The optional `footer` slot fills the bottom-right corner — the deck builder
  puts its `CopyStepper` there — and takes the button's place. The modal is
  portalled to `document.body` because both are rendered inside `scale-*`
  wrappers, which would otherwise capture `position: fixed`. **A portal only
  moves the DOM node, not the React tree** — events still bubble to the card
  face's `onClick`, so the modal's backdrop handler must `stopPropagation()`
  or clicking away closes the modal and the same event immediately re-opens
  it. Its fade-in rides CSS `@starting-style` (Tailwind's `starting:` variant)
  rather than a rAF-flipped class, which would never fire on a page that isn't
  compositing; the fade-out holds the overlay mounted for `FADE_MS`. Keyword rule text
  lives in that one module (frontend-only, so it is outside functions:sync);
  `keywords.test.ts` fails if a KEYWORDS/VEHICLE_TYPES value has no entry.
- Function errors: `FunctionsHttpError` → `await error.context.json()` →
  `errors.join('; ')` rendered inline near the triggering control (pattern in
  `GamesPage.tsx` / `useGameActions.ts`).

## Realtime + reconnect (`src/lib/realtime.ts`, `src/lib/reconnectPolicy.ts`)

`useRealtimeInvalidate(channelKey, table, queryKeys, filter?)` subscribes to
postgres_changes and invalidates the given query keys. It is deliberately
self-healing; **do not simplify away** any of these, each covers a real failure:

- Backoff policy is a pure module (`reconnectPolicy.ts`, tested): 1s base,
  30s cap.
- **Unique per-connect topics** `${channelKey}#${seq}`: supabase-js returns the
  EXISTING (possibly draining) channel for a matching topic and `subscribe()`
  no-ops on non-closed adapters — reusing a topic yields a dead subscription.
- Generation tokens guard stale callbacks; the reconnect timer is cleared both
  at `connect()` entry and in the settled branch.
- `online` + `visibilitychange` wake: joined → invalidate (catch-up), else
  reconnect. On SUBSCRIBED it invalidates all keys (missed-window catch-up).

QueryClient is configured `{ refetchOnReconnect: 'always', retry: 2 }`. Call
sites: GamesPage, LobbiesPage ×2, GameBoardPage ×2 — reuse the hook, don't
hand-roll channels.

## Game board (`src/pages/game/`)

- `GameBoardPage.tsx` owns mutually-exclusive interaction modes (placing /
  moveMode / fieldTargeting / swapMode) — add new modes through `cancelAllModes`
  so they stay exclusive. Battle UI (`BattleOverlay`, `StealthyResponseBar`) is
  gated on `status === 'active'`; end-states render an overlay instead.
- `HandBar.tsx` derives targeting modes from card meta keys (via the registry's
  `effectName`) and holds the `ALL_TRIGGER_KEYS` duplicate noted in
  [card-effects.md](card-effects.md).
- Costs shown to the player use `effectiveCostInGame` (typed over
  `PublicGameState` precisely so the client can call it).

## My Games (`src/lib/games.ts`)

`isMyMove(g, me)` classifies whose move it is and MUST keep handling
battle-frozen states: `pendingReport` → it's your move iff `submittedBy` isn't
your side; `awaitingResponse` → yours iff `aggressor` isn't your side; otherwise
`active_player === me`. (Known accepted quirk: the post-declare/pre-report
`activeBattle` phase is attributed to the active player though either may
submit.) Query key is `['games']`.
