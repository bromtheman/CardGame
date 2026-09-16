# 2026-09-16 AI opponent — practice games — design

Adds a server-driven opponent, **PracticeAI**, that a host can seat in the
challenger slot of any lobby. The bot plays the card game; the human still
fights every battle in From The Depths. Nothing about the engine's rules
changes — the bot is one more caller of `applyAction`, and the engine remains
the only authority on what is legal.

The 2026-08-24 design spec stays binding for everything this document does not
name; §11 below records the practice-game rulings that spec's §1 decisions log
now points at. Read [docs/claude/architecture.md](../../claude/architecture.md)
before touching the engine, [docs/claude/supabase.md](../../claude/supabase.md)
before the migration or a deploy, and
[docs/claude/frontend.md](../../claude/frontend.md) before the lobby changes.

## 1. Decisions

| Decision | Choice |
|---|---|
| Where the bot runs | Inline in `game-action` (and in lobby `START` when the bot is rolled first), applied in memory after the human's action and committed in the **same** `apply_action_tx` transaction. No new function, no client trigger, no cron. |
| Bot identity | One real auth user + `profiles` row (`profiles.is_bot = true`), provisioned once by hand. The `games`/`decks`/`game_players` FKs to `profiles` leave no other option. |
| Bot decks | Curated per-faction lists **in code** (`shared/ai/botDecks.ts`), pinned by a test against the seed source, materialised into a bot-owned `decks` row by `ADD_BOT`. No hand-applied data. |
| Battles | The human spawns both fleets, runs the fight, and submits the report. The bot **never submits** a report and **always approves** one. Results are on the honour system. |
| First player | Still rolled randomly (spec §3.1). Practising going second is half the point. |
| Commit granularity | One version per human request, bot turn included. The public log narrates the bot's moves; animating them is a later UX pass, not an architectural change. |
| Strength | One policy, no difficulty levels. Greedy, stateless, legality delegated to the engine. |
| Hidden information | The policy is handed a `BotView` holding only the bot's own hand; it never sees an `EngineGame`. |

## 2. How a practice game plays

1. The host creates a lobby as today, picks a deck and settings.
2. In the empty challenger seat the host chooses a faction and presses **Add
   AI opponent**. The seat fills with PracticeAI, its faction pill, and a ready
   tick. **Remove** is the existing `KICK`.
3. The host readies and starts. If the roll gives the bot the first turn, it
   has already played it by the time the board loads.
4. On the human's `END_TURN`, the bot's whole turn resolves inside that
   request: it plays what it can afford, attacks where it can, ends its turn.
   The human's board refreshes once with the outcome and the log tells the
   story.
5. When either side declares a fleet battle, the human gets the usual spawn
   sheet and FtD launch, runs the fight, and submits the report (the C# mod's
   prefill still works — the human is the only one minting battle tokens).
   The bot approves it in the same request, paying for whatever repairs its
   policy chose. If the battle was the bot's, its turn then continues to
   `END_TURN` in that same request.
6. A practice game is an ordinary game in My Games: it has a status and a
   winner, and the human may concede or abandon as usual. The bot never
   concedes.

## 3. Identity and data

### 3.1 The bot account

`games.player_b`, `games.active_player`, `game_players.player_id` and
`decks.owner_id` all reference `public.profiles`, which references
`auth.users`. So the bot is a real user:

- Username **`PracticeAI`** (fits `^[A-Za-z0-9_]{3,20}$`), created once via
  the dashboard or the admin API with a confirmed email and a random password
  that is never recorded; then banned from sign-in. It has no session, so it
  can never host, join, or act through the normal ops — only the two server
  paths in §4 and §5 ever act as it.
- Migration adds `profiles.is_bot boolean not null default false`; the
  bootstrap sets it on that one row. `lobby-action` finds the bot with
  `select id from profiles where is_bot order by created_at limit 1` and
  answers **503 "AI opponent is not provisioned"** if there is none — never a
  guess by username.
- The bootstrap is a runbook step in `docs/claude/supabase.md` (§10.3) and an
  item on the pre-launch checklist. Deploying before bootstrapping is safe:
  `ADD_BOT` 503s until the row exists, and nothing else changes.

### 3.2 Bot decks in code

`shared/ai/botDecks.ts` exports
`BOT_DECKS: Record<BotFaction, Record<string, number>>` (`BotFaction` is the
union of the five below, `BOT_FACTIONS` the ordered list) —
card **name → copies**, one list per faction the bot can field: **DWG, OW, SS,
WF, TG**. GT and LH are left out (owner decision 2026-09-16: neither faction
is fully implemented yet; GT is also all-flier and cannot satisfy the
default flier cap). Adding one later is a new list plus a `BOT_FACTIONS`
entry.
Names are the key because seeded ids are deterministic
(`uuidv5("card:FACTION:NAME")`, `supabase/seed/transform.ts`) and names read
in review; ids are resolved at `ADD_BOT` time (§4.1).

Curation constraints, each pinned by `shared/ai/botDecks.test.ts` reading the
seed **source** through `loadSeedData()` (the way `effectCoverage.test.ts`
does), so a retirement or rename fails CI rather than a lobby:

- Passes `validateDeck` under `DEFAULT_DECK_RULES`: exactly 20 cards, ≤ 2
  copies, built-in only (so `playerCardLimit` is moot), faction or NEUTRAL,
  ≤ 6 flier copies, ≤ 6 submarine copies.
- No `retired` and no `summonOnly` card.
- **Playable on the default all-water board:** at most 3 tank copies (tanks
  need beach or land, and a default lobby has neither).
- At least 12 vehicles, with enough hulls at or under 75,000 and 150,000
  materials that turns 1 and 2 have a play.

The lists themselves are drafted in the implementation from the seed source
and reviewed by the owner in the PR; this document fixes the constraints, not
the cards. Bot decks are built for the **default** deck rules — see ruling 4
in §11 for lobbies that override them.

## 4. Lobby flow — the bot fills the challenger seat

The lobby row already carries `guest_id`, `guest_deck_id`, `guest_faction`,
`guest_ready`, and `LobbyPage` renders the seat from those columns. The bot
occupies the seat exactly as a human would, so `START` keeps its single path.

### 4.1 `ADD_BOT`

`lobby-action` op `{ action: 'ADD_BOT', lobbyId, faction }`.

Checks, in order: signed in (401); lobby exists (404); caller is the host
(403); lobby `open` and seat empty (409 "Lobby already has a challenger");
`faction` is a `BOT_DECKS` key (400); bot provisioned (503, §3.1); the bot
deck passes `validateDeck` under the lobby's **current** rules
(`DEFAULT_DECK_RULES` merged with the lobby's `deckRules`) — 409 "PracticeAI's
decks are built for the default deck rules" otherwise.

Deck materialisation:

1. `select id, name from cards where is_built_in and faction in (F, 'NEUTRAL')
   and name in (<names>)` against the **live** table — the rows the game will
   actually play. Any name that does not come back → 409 naming it; that is
   the "live rows drifted from the seed" signal, and `seed:verify` is the
   fix.
2. Build `cards: Record<cardId, count>`.
3. `select id, cards from decks where owner_id = bot and faction = F`; reuse
   a row whose `cards` deep-equal the built map, else insert
   `{ owner_id: bot, name: 'PracticeAI ' + F, faction: F, cards }`. Rows are
   never deleted — a stale one is harmless, and `lobbies.guest_deck_id` is
   `on delete set null` anyway.

Seat the bot with a conditional update in the `JOIN`/`KICK` shape, so a human
who joined between the read and the write wins the race:

```ts
.update({ guest_id: bot, guest_deck_id: deckId, guest_faction: F, guest_ready: true })
.eq('id', lobbyId).eq('status', 'open').eq('host_id', userId).is('guest_id', null)
```

No row updated → 409. Returns `{ lobby }` — the updated row, the JOIN shape.
Realtime delivers the seat to the host's page as it does for a human join.

### 4.2 `START` additions

`START` runs unchanged — the lock statement, the deck ownership checks (the
bot owns its deck row), `validateDeck` for both seats — with two additions
after `locked`:

1. One read: `select is_bot from profiles where id = locked.guest_id`. If the
   guest is the bot, the frozen settings become
   `{ ...lockedParsed.settings, bot: { side: 'b' } }` (§4.3).
2. After `buildInitialGame`, if `built.game.activePlayer === locked.guest_id`,
   assemble an `EngineGame` —
   `{ ...built.game, status: 'active', winnerId: null, turnNumber: STARTING_TURN_NUMBER, privates: { a: built.aPrivate, b: built.bPrivate } }`
   — and run the driver (§5) on it before `start_game_tx`. The RPC receives
   the post-turn game and privates.

For a bot game `START` additionally loads the whole built-in catalog (one
query, `is_built_in = true`) for the engine `ctx.catalog` — the deck
`snapshots` still come from the per-deck rows query, so the human path is
untouched — because the bot's opening plays may fire catalog effects.
`lobby-action` therefore imports `./shared/engine/index.ts` (the
registry-populating index, per the CLAUDE.md hard rule), and the sync manifest
grows to match (§10.2).

`start_game_tx` today inserts `turn_number` by column default (1.0) and never
reads `status`/`winner_id` from `p_game`; the migration (§10.1) makes it read
all three with defaults, same signature, replaced in place.

### 4.3 The frozen `settings.bot` flag

`EngineGame['settings']` gains `bot?: { side: Side }`. It is stamped only by
`START` (§4.2). It cannot be smuggled in through lobby settings:
`validateLobbySettings` builds its result from known keys
(`zones`, `materialsPerTurn`, `deckRules`) and drops everything else, so a
client-supplied `bot` never survives validation. Absent means what every
existing row means — a human game — so `normalizeState` needs no default.

`shared/ai/botGame.ts` is the one reader:

```ts
export const BOT_USERNAME = 'PracticeAI'
export function botSideOf(settings: { bot?: { side: Side } } | null | undefined): Side | null
export function botPlayerId(game: Pick<EngineGame, 'playerA' | 'playerB' | 'settings'>): string | null
```

Every consumer — `game-action`, `START`, the frontend — goes through
`botSideOf`, the `materialsPerTurnOf` shape.

## 5. The driver — `shared/ai/botDriver.ts`

Pure, deterministic given `ctx.rng`, synced into both functions.

### 5.1 `botOwes(game, botSide): 'choice' | 'response' | 'decision' | 'turn' | null`

Checked in the engine's own freeze order (`applyAction`: pending effect first,
then battle, then turn):

| State | Owes |
|---|---|
| `game.status !== 'active'` | `null` |
| `pendingEffect` with `side === botSide` | `'choice'` |
| `pendingEffect` for the other side | `null` — the human owes a choice; the bot waits |
| `awaitingResponse` with `otherSide(aggressor) === botSide` | `'response'` |
| `awaitingResponse` with the bot as aggressor | `null` — the human decides opt-outs |
| `pendingReport` with `submittedBy !== botSide` | `'decision'` |
| `pendingReport` submitted by the bot | unreachable — the bot never submits |
| `activeBattle` locked, no report | `null` — the human fights in FtD and reports |
| `activePlayer === botId` (and none of the above) | `'turn'` |
| otherwise | `null` |

### 5.2 `runBotUntilIdle(game, botId, ctx, policy): { game, applied: GameAction[] }`

```
while (kind = botOwes(game, side)):
  candidates = policy.candidates(viewFor(game, side), kind)   // best first
  for action of candidates:
    r = applyAction(game, botId, action, ctx)
    if r.ok: game = r.game; break
  if none accepted: apply FALLBACK[kind]; if that is rejected → throw
  cap: after 60 accepted policy actions, candidates are skipped and only
       FALLBACK[kind] is applied, for at most 10 more iterations, then throw
```

| Owed | Fallback (always legal by the engine's own rules) |
|---|---|
| `'turn'` | `END_TURN` |
| `'response'` | `RESPOND_TO_ATTACK { optOutIds: [] }` |
| `'decision'` | `DECIDE_BATTLE_REPORT { approve: true, repairs: [] }` |
| `'choice'` | `RESOLVE_PENDING_EFFECT { cancel: true }` |

The policy's output is only ever a suggestion; `applyAction` clones the game
and rejects without side effects, so a bad candidate costs one clone. A
rejected fallback means an engine bug and surfaces as a thrown error; tests
pin that every owed kind's fallback is accepted from every fixture that
produces it.

### 5.3 Hidden information — `viewFor(game, side): BotView`

```ts
interface BotView {
  state: PublicGameState      // public by definition
  settings: EngineGame['settings']
  turnNumber: number
  side: Side
  hand: CardInstance[]        // privates[side].hand — the bot's own, nothing else
  rng: () => number
}
```

The policy module imports no `EngineGame` type and receives no `privates`. A
test serialises the view for a game whose opponent hand and deck hold known
instance ids and asserts none of them appears anywhere in it. `state.counts`
(public hand/deck sizes) and `pendingEffect.options` (public by the
card-effects hidden-information rule) are the only opponent information the
policy can ever read, exactly as for a human.

### 5.4 Call sites

- **`game-action`**, after `applyAction` succeeds for the human's action and
  before `apply_action_tx`:

  ```ts
  let next = result.game
  const botId = botPlayerId(next)
  if (botId) next = runBotUntilIdle(next, botId, ctx, basicPolicy).game
  ```

  The catalog probe gains a sixth source: **a bot game always loads the
  catalog**, because the bot's own plays are not in any probe list. A throw
  from the driver is caught separately from the human's `Malformed action`
  path and answered **500 `AI opponent failed: <message>`** with nothing
  committed — the game stays consistent and the error is visible. The human's
  `CONCEDE`/`ABANDON` still work: after either, `botOwes` is `null`.

- **`START`**, as in §4.2, only when the bot is rolled first.

Consequences the owe-check handles with no extra logic: a fleet battle the
bot declares mid-turn freezes the loop (it owes nothing while the human
fights); the human's `RESPOND_TO_ATTACK` that cancels the battle (all
defenders opted out; the activation is not spent) hands the turn back and the
loop continues; the human's `SUBMIT_BATTLE_REPORT` produces `'decision'`, and
once approved the bot is still `activePlayer` and finishes its turn; the
human's `RESOLVE_PENDING_EFFECT` can hand the bot a choice next (Terawatt's
join, DWG Waters' summon) and the loop answers it.

## 6. The basic policy — `shared/ai/basicPolicy.ts`

`candidates(view, kind): GameAction[]`, best first, stateless. Every
tie-break goes through `view.rng`, so tests seed it. The policy re-evaluates
from the live state on every call, which is what lets a turn interrupted by a
battle resume correctly.

### 6.1 `'turn'`

1. **Play.** For each hand card passing `canAfford(state, side, card)`:
   - vehicle → `PLAY_CARD_TO_ZONE` for each zone in `legalZonesFor`;
   - ability → by its trigger key, the same dispatch `HandBar.tsx` uses:
     `playOnZoneEffect` → each zone; `playOnVehicleEffect` → each on-field
     hull, in rng order; `playOnCardEffect` → each other own hand card;
     otherwise plain `PLAY_ABILITY_CARD`.

   Vehicles rank above abilities; within each, higher
   `effectiveMaterialCostOf` first — *play the biggest thing you can afford*.
   Zone preference, applied to every zone-taking candidate: enemy base alive
   before destroyed, then lowest enemy base HP, then fewest enemy hulls —
   concentrate on finishing a base. The driver's loop repeats this step until
   no play is accepted, because each accepted play changes affordability.
2. **Attack.** Per zone in the same preference, when the bot has a hull
   there: `ATTACK_ENEMY_BASE` first (blocker, destroyed base, fresh
   deployment, subs/Inoffensive-only, zero damage and already-activated are
   all engine rejections — just try); then `ATTACK_ENEMY_FLEET { zoneId }`.
   Since the 2026-09-16 amendment to spec §3.4 a fleet attack has no
   selection — every own non-Inoffensive hull in the zone attacks every enemy
   hull there — so the only decision is *whether* to declare: the policy
   offers it when the sum of `effectiveMaterialCostOf` over its
   non-Inoffensive hulls in the zone is at least the sum over the enemy's.
   A zone where it has only Inoffensive hulls is an engine rejection.
3. `END_TURN`.

Play before attack: hulls played this turn cannot strike a base (spec §3.4),
but they can be in a fleet battle, and a bigger fleet is the better battle.

### 6.2 Off-turn

- **`'response'`** — `RESPOND_TO_ATTACK { optOutIds: [] }`: it fights.
- **`'decision'`** — `DECIDE_BATTLE_REPORT { approve: true, repairs }` where
  `repairs` is the bot's own participants with reported HP in
  `[REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT)`, not summons, not
  `fragileInBattle`, and not Scrappy — Scrappy hulls repair for free and the
  engine applies that itself (`autoRepairIds`), so they never go in the list.
  Candidates are ordered by `effectiveMaterialCostOf` descending (save the
  most valuable hull first) and taken while cumulative `repairCostOf` fits
  `state.resources[side].materials`. The engine's own affordability check
  backstops any mismatch through the empty-repairs fallback.
- **`'choice'`** — `RESOLVE_PENDING_EFFECT { choiceId }` for one of
  `pendingEffect.options` chosen uniformly by `rng`. Effect-aware choices are
  a follow-up (§12).

### 6.3 Not in v1

`MOVE_VEHICLE`, `ACTIVATE_VEHICLE`, `SET_ALERT_CARD`, every hero power
(universal and faction), stealthy opt-outs, and any lookahead. Each is a
follow-up in §12. The engine's rules are the ceiling on how badly the bot can
misplay: it cannot cheat, deadlock, or act out of turn, only play weakly.

## 7. Frontend

- **`LobbyPage`** — in the host's view of the empty challenger seat, a
  faction `<select>` (the five `BOT_DECKS` keys) and an **Add AI opponent**
  button → `lobby-action ADD_BOT` (new `addBot` in `frontend/src/lib/lobbies.ts`).
  The filled seat renders as today plus an **AI** pill; **Remove** is the
  existing `KICK`. Guests never see the control. The usernames query in
  `frontend/src/lib/games.ts` gains `is_bot`, which is what the pill reads.
- **`GameBoardPage` / `BattleOverlay`** — for `botSideOf(game.settings)`
  games the deploy-order lines become *"Practice game — you spawn both
  fleets, run the fight and submit the report; the AI approves it
  automatically."* The `WaitingNotice` after a submit is momentary (the
  decision lands in the same request) and needs nothing.
- **`GamesPage`** — an **AI** tag beside the opponent name when
  `botSideOf(g.settings)` is set.
- `frontend/src/lib/database.types.ts` gains `profiles.is_bot`.

Board, hand, log, report form, FtD launch, mod prefill, realtime and reconnect
are untouched. "Opponent's turn" states resolve inside the human's own
request, so nothing waits on a second client.

## 8. Files touched

| File | Change |
|---|---|
| `supabase/migrations/<ts>_ai_opponent.sql` | `profiles.is_bot`; `start_game_tx` replaced in place (§10.1) |
| `shared/engine/engineTypes.ts` | `settings.bot?: { side: Side }` |
| `shared/ai/botGame.ts` | `BOT_USERNAME`, `botSideOf`, `botPlayerId` |
| `shared/ai/botDecks.ts` (+ `.test.ts`) | the five lists; seed-source pin |
| `shared/ai/botView.ts` (+ `.test.ts`) | `BotView`, `viewFor`; isolation test |
| `shared/ai/basicPolicy.ts` (+ `.test.ts`) | §6 |
| `shared/ai/botDriver.ts` (+ `.test.ts`) | §5 |
| `shared/ai/selfPlay.test.ts` | seeded self-play smoke (§9) |
| `supabase/functions/lobby-action/index.ts` | `ADD_BOT`; `START` additions; engine index import |
| `supabase/functions/game-action/index.ts` | driver hook; catalog rule; 500 path |
| `supabase/functions/shared-manifest.json` + synced copies | §10.2 |
| `frontend/src/pages/LobbyPage.tsx`, `lib/lobbies.ts`, `lib/games.ts`, `pages/GamesPage.tsx`, `pages/game/BattleOverlay.tsx`, `lib/database.types.ts` | §7 |
| `docs/claude/supabase.md`, `CLAUDE.md`, main spec §1 | bootstrap runbook; task-doc pointer; decisions-log row |

`shared/ai/*` follows the `shared/` rules: `.ts` extensions on relative
imports, `applyAction` imported from `../engine/index.ts`, no npm imports
(the code runs verbatim in Deno).

## 9. Test plan

Unit, on `makeGame`/`makeCtx`/`zoneEntry` fixtures with a seeded rng:

- **Policy** — plays an affordable vehicle into a legal zone and not into an
  illegal one; ranks the more expensive of two affordable hulls first; targets
  the lowest live enemy base; `ATTACK_ENEMY_BASE` when legal, else
  `ATTACK_ENEMY_FLEET` only when stronger, else nothing; ends the turn when
  nothing else applies; repairs within budget, most valuable first, never a
  Fragile, summoned or Scrappy hull; opts out nothing; resolves a choice to
  one of the offered ids.
- **Driver** — a full turn from a fixture ends with the human active; stops at
  a locked battle the bot declared; resumes after `SUBMIT_BATTLE_REPORT` and
  finishes the turn; answers a bot-side choice raised by the human's play;
  never applies an action when the human owes (choice, response, report);
  never acts on a finished game; the 60/10 cap holds against a policy that
  returns an endless supply of accepted no-op-shaped actions; the fallback
  ladder ends the turn against an injected policy that returns only illegal
  actions; each owed kind's fallback is accepted from a fixture producing it.
- **View** — no opponent hand or deck instance id appears in the serialised
  `BotView`.
- **Decks** — every list against the seed source: §3.2's constraints.
- **`botSideOf`** — absent, malformed and present settings.

Seeded **self-play smoke** (`shared/ai/selfPlay.test.ts`): the bot against a
scripted opponent that ends its turns, answers responses with no opt-outs,
resolves choices at random, and reports every battle with rng-drawn ending HP
so deaths, repairs and death triggers fire — over ~20 seeds × all five bot
decks on the default board, asserting no throw and either a terminal status
or a 40-turn cap. This is the net for effect interactions among the 170
seeded cards; a failure names the seed and deck so it reproduces.

Gates: `npx vitest run`, `npx tsc -p tsconfig.json --noEmit`,
`npm run functions:check` (both functions now type-check the engine),
`supabase/seed/functionSharedSync.test.ts` (manifest change),
`npm --prefix frontend run build` and `lint`.

Live smoke after deploy and bootstrap, via `node scripts/qa-login.mjs`: create
lobby → `ADD_BOT` → ready → `START` (both first-player outcomes, re-rolling
lobbies until each is seen) → three turns → one bot-declared and one
human-declared battle, each reported and auto-approved → `CONCEDE`.

## 10. Migration and deploy

### 10.1 Migration

One file, fresh timestamp:

```sql
alter table public.profiles add column is_bot boolean not null default false;

create or replace function public.start_game_tx(
  p_lobby_id uuid, p_game jsonb, p_player_a_state jsonb, p_player_b_state jsonb
) returns uuid ... -- identical signature, so it replaces in place
  insert into public.games (id, lobby_id, player_a, player_b, active_player,
                            settings, state, turn_number, status, winner_id)
  values (..., coalesce((p_game->>'turnNumber')::numeric, 1.0),
               coalesce(p_game->>'status', 'active'),
               nullif(p_game->>'winnerId', '')::uuid)
```

Every existing caller passes a `p_game` without those keys and gets the old
defaults. The migration is applied by the integration on merge; a failed
migrate step silently skips the function deploy (docs/claude/supabase.md), so
check `schema_migrations` first if the versions do not move.

### 10.2 Manifest and sync

`supabase/functions/shared-manifest.json`: `lobby-action` gains every
`engine/*` and `effects/*` entry `game-action` has, plus `ai/botGame.ts`,
`ai/botDecks.ts`, `ai/botView.ts`, `ai/basicPolicy.ts`, `ai/botDriver.ts`;
`game-action` gains the five `ai/*` files. `npm run functions:sync` in the
same commit, or `functionSharedSync.test.ts` fails. `functions:deploy` reads
the same manifest, so a manual deploy can never omit a file the function
imports.

### 10.3 Bootstrap runbook (once, after the first deploy)

1. Dashboard → Authentication → Add user: email of your choosing, confirmed,
   random password; user metadata `{ "username": "PracticeAI" }` so
   `handle_new_user` creates the profile. Then ban the user from sign-in.
2. `update public.profiles set is_bot = true where username = 'PracticeAI';`
3. `select id, username, is_bot from public.profiles where is_bot;` — exactly
   one row.

Until step 2 lands, `ADD_BOT` answers 503 and nothing else is affected. Add
the check to the pre-launch checklist.

### 10.4 Order of operations

1. Merge the PR: migration applies, both functions deploy. Verify **both**
   function versions incremented, by content (a deploy legitimately reads
   back with fewer modules — type-only imports are erased).
2. Bootstrap (§10.3).
3. Live smoke (§9).
4. `npm run seed:verify` is unaffected — no seed changes — but run it anyway
   before the smoke, because `ADD_BOT` resolves names against live rows.

## 11. Rulings — practice games

Recorded here and pointed at from the 2026-08-24 spec's decisions log.

1. **The human reports every battle.** The defending-player-spawns-both-fleets
   rule (§3.5) already puts one human in charge of the fight; in a practice
   game that is always the human, whichever side declared.
2. **The bot approves every report** and never submits one. Results are on the
   honour system; a practice game is not evidence of anything.
3. **The bot never concedes or abandons.** A game ends by base loss or by the
   human's concede/abandon.
4. **Bot decks are built for the default deck rules.** A lobby whose
   `deckRules` reject the bot's 20-card list refuses `ADD_BOT` with a message
   saying so; a host who changes the rules *after* seating the bot gets
   `START`'s existing "Guest deck: …" error and can `KICK` and re-add.
5. **The bot is only ever the challenger** (`player_b`). `settings.bot.side`
   carries the side anyway, so nothing downstream hard-codes `'b'`.
6. **The first player is rolled** as in any game.
7. **One human per practice game.** A lobby with the bot seated is full.

## 12. Non-goals and follow-ups

Not in this design: difficulty levels; the bot playing FtD or any combat
simulation (spec §1 rules it out); ranked play or matchmaking; the bot as
host; two bots in one game; per-action animation of the bot's turn (a UX pass
over `state.log` deltas, no architecture needed); turn timers.

Follow-ups in rough value order, each a small change to `basicPolicy.ts`
alone: `draw` and `salvage` hero powers when CP allows; opting Stealthy hulls
out when outmatched; `MOVE_VEHICLE` to reinforce a threatened base;
`ACTIVATE_VEHICLE` for hulls that carry `activateCpCost`; effect-aware choice
hints keyed by registry id (never by card name — the same rule as effects);
faction hero powers.
