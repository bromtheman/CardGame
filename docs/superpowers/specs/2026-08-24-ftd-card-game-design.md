# FTD Card Game — Design Spec

**Date:** 2026-08-24
**Status:** Approved pending user review
**Supabase project:** `FtD Card Game` (`wpgsjnjnvykxavaxibld`, us-west-2)
**Repo:** https://github.com/bromtheman/CardGame.git → local `C:\Users\JFinn\FtDCardGame`

A persistent, realtime, 1v1 turn-based card game companion for **From The Depths** (FTD).
Players build decks of vehicle and ability cards, play them into zones, attack bases, and
resolve fleet battles *inside FTD itself*, reporting results back to the app.

Reference material (read-only, do not port bugs):

- Old FE: https://github.com/joey101937/ftd-cg-frontend — reuse SVG icons, logo, font, palette, card layout
- Old BE: https://github.com/joey101937/ftd-cg-backend — reuse card data (`src/gameConstants/builtInCards/`), action vocabulary, effect-registry pattern, pending-change flow

## 1. Decisions log

| Decision | Choice |
|---|---|
| Battle resolution | Manual result entry; mutual-approval battle reports (no combat simulator) |
| Card data source | Seed from old BE `builtInCards/` files — all 6 factions (~120 cards), including LH (old seeder skipped it) |
| Auth | Supabase email + password only; username chosen at signup |
| Built-in card editing | Supabase Studio only (no admin UI) |
| Rules defaults | Old BE numbers: 20-card decks, max 2 copies, 1000 base HP/zone |
| Configurable at game setup | Zone biomes (each of 3 zones: water/beach/land) and base HP per zone |
| Play cadence | Persistent games + Supabase Realtime push; async-capable, feels live when both online |
| Custom cards | In MVP: manual stats entry only (no blueprint file upload/parsing) |
| Rules enforcement | Server-authoritative via Supabase Edge Functions |
| Frontend | React SPA (Vite), no Next.js; Netlify hosting later |
| Deck faction | Every deck selects a base faction (DWG/GT/LH/OW/SS/WF); it constrains built-in cards and attaches that faction's hero powers |
| Hero powers | 4 universal (NEUTRAL) powers + per-faction powers from old BE `heroPowers.js`, seeded into a `hero_powers` table |

## 2. Repository layout

```
CardGame/
  frontend/                 Vite + React 18 + TypeScript SPA
    src/
      assets/               icons (20 SVGs), logo, Lobster font — from old FE repo
      components/           shared UI (PhysicalCard, CostBadge, NavBar, ...)
      pages/                one folder per route
      lib/                  supabase client, query hooks, realtime subscriptions
      theme/                design tokens (ocean palette)
  shared/                   pure TypeScript, zero I/O, zero deps
    gameSettings.ts         ALL tunable numbers and enums (single source of truth)
    types.ts                Card, GameState, Zone, PendingChange, actions...
    engine/                 rules: action dispatcher, validators, battle resolution
    effects/                string-keyed card effect registry
  supabase/
    migrations/             SQL migrations
    functions/              Deno edge functions (import shared/ via relative path)
    seed/                   card seed script + data transformed from old BE
  docs/superpowers/specs/   this file
  netlify.toml              SPA redirects + build config
```

`shared/` is imported by both the frontend (path alias) and edge functions. It
must stay dependency-free and side-effect-free so it runs in both runtimes and
is trivially unit-testable, and its internal relative imports carry explicit
`.ts` extensions (a Deno requirement). Because remote-only MCP deploys can't
reach outside a function's directory, each edge function carries synced copies
of the shared modules it needs (`npm run functions:sync`), kept honest by a
byte-equality drift test in the root suite.

## 3. Game rules reference

All numbers below are **defaults** defined in `shared/gameSettings.ts`; per-game
overrides come from lobby settings. Nothing is hardcoded at usage sites.

### 3.1 Setup

- 2 players. Roles `playerA` (host) / `playerB` (guest); first player rolled randomly at game start.
- 3 zones, left to right, ids 1–3. Each zone has a biome from lobby settings
  (default: all water). Each player has a base in each zone with HP from lobby
  settings (default **1000**).
- Every deck has a required **base faction**, chosen at deck creation from:
  **DWG, GT, LH, OW, SS, WF**. Built-in cards in the deck must belong to that
  faction or NEUTRAL; the deck's faction also determines which faction hero
  powers its player has in game (3.8).
- Decks validated server-side at game start: exactly **20** cards, max **2** copies
  per card, max **4** custom (player-created) cards, max **6** total flier copies,
  max **6** total submarine copies, built-in cards matching the deck's base
  faction (or NEUTRAL). Each rule is an independent constant — easy to change or
  disable.
- Deck is expanded into card instances (`instanceId` per copy), shuffled. Starting
  hand: **5** cards. Starting CP: **3**. Starting materials: turn-1 income (see below).

### 3.2 Turn flow

- `turnNumber` starts at 1.0 and advances +0.5 per end-turn (x.0 = playerA, x.5 = playerB).
- At the start of each turn (either player's): remove all **Temporary** vehicles
  (both sides), then the active player draws 1 (empty deck → no draw, no penalty)
  and sets materials to `floor(turnNumber) × 50,000` (materials do NOT carry over
  between turns — mana-style). CP persists and is only gained via effects.
- On their turn the active player may, in any order: play cards (paying material/CP
  costs), use hero powers, and activate zones. Then END_TURN.

### 3.3 Placement rules

- Surface ships & submarines → water or beach zones. Land vehicles (tanks) → beach
  or land zones. Planes & airships → any zone.
- An enemy vehicle with **Air Screen** in a zone blocks you from playing
  planes/airships there; **Sub Screen** blocks submarines.

### 3.4 Zone activation

Each zone may be activated at most **once per turn**, by the active player, if they
have ≥1 vehicle there. Two options:

1. **Attack the enemy base.** Illegal if any enemy vehicle in the zone has
   **Blocker**, or if the enemy base in that zone is already destroyed. Damage =
   `Σ floor(materialCost / 1000)` over the activator's eligible vehicles in the
   zone. Ineligible: submarines, **Inoffensive** vehicles, and vehicles played this
   turn (1-turn delay).
2. **Attack the enemy fleet.** Requires ≥1 enemy vehicle in the zone. Activator
   selects any number of their own vehicles (excluding **Inoffensive**) and any
   number of enemy vehicles. If any selected enemy vehicle has **Stealthy**, its
   owner is prompted to opt it out (3.7) before the battle locks in; a battle
   whose defenders all opt out is cancelled (the zone activation is not spent).
   This creates an **active battle** (see 3.5).

### 3.5 Battles (fought out-of-band in FTD)

- Creating a battle freezes the game: while a battle is active, the only legal
  actions are battle-related (submit report, approve/reject report, the
  spawn-distance hero power). The battle stores: zone, participating vehicle
  instances per side, aggressor, spawn distance.
- Spawn distance default **1.2 km**; modifiable by effects/hero power within
  **50 m – 2 km**. The app shows both players a **spawn sheet**: what to spawn,
  which side, distance, altitude guidance (surface vessels/subs at surface,
  aircraft at 80 m, land vehicles on land), and in-battle resources = **10%** of
  each vehicle's material cost. The defending player spawns both fleets in FTD and
  runs the fight per the doc's end conditions (all ≤80% HP, 2-min no-damage, or
  one side incapacitated).
- Either player then submits a **battle report**: ending HP % per participating
  vehicle. The server computes outcomes: **≥90%** survives; **80–89.999%**
  destroyed unless its owner pays the repair cost (½ material cost; free with
  **Scrappy**) — repair choices are part of the report; **<80%** destroyed, no
  repair. **Fragile** vehicles can never be repaired (3.7).
  The opponent **approves or rejects** the report. Approve → outcomes
  applied (destroyed vehicles removed), battle ends, turn continues. Reject →
  battle stays active; a corrected report can be submitted by either player.

### 3.6 Winning

A base at 0 HP means that zone is **lost** for its owner. Losing **2+ zones** loses
the game. A destroyed base cannot be attacked again; vehicles in that zone remain
and may still fight fleet battles.

### 3.7 Keywords

MVP-implemented (from the design doc + old BE `gameSettings.js` comments):

- **Blocker** — opponent may not declare base attacks in this zone
- **Temporary** — removed at the start of the next turn (3.2)
- **Scrappy** — no repair cost
- **Air Screen** — opponent may not play planes/airships into this zone
- **Sub Screen** — opponent may not play submarines into this zone
- **Inoffensive** — cannot participate in offensive battles or base attacks
- **Half-Cost** — vehicle costs 50% of blueprint cost (the flier rule)
- **Stealthy** — when the opponent declares a fleet attack, this vehicle's owner
  may exclude it from the defending selection (opt out of defensive battles)
- **Mobile** — its owner may move it to another legal zone once per turn
  (via the MOVE_VEHICLE action; free, doesn't activate the zone)
- **Robotic** — battle-conduct rule shown on the spawn sheet: unlimited
  in-battle repair resources, but the vehicle is considered destroyed if any of
  its sub-objects are destroyed (players apply this when reporting results)
- **Fragile** (auto-assigned to airships) — cannot be repaired once below 90%
  HP: the 80–89.999% repair window (3.5) does not apply; the vehicle is simply
  destroyed. Overrides Scrappy.

Flier special rules: planes get Half-Cost + Temporary automatically. Submarines
cannot damage bases. Both are deck-limited to 6 copies (3.1).

### 3.8 Hero powers

A player's available hero powers = the **4 universal (NEUTRAL) powers** + the
powers of **their deck's base faction**. Each usable **once per game**, each
costs **1 CP**. Seeded from the old BE's `heroPowers.js` into the `hero_powers`
table:

Universal (NEUTRAL):

1. **Salvage** — return one of your own destroyed vehicles' card to hand
2. **Tactical Positioning** — modify one battle's starting distance by up to
   ±600 m (within 50 m–2 km)
3. **Hero Power Draw** — draw a card
4. **Rapid Redeployment** — move a friendly vehicle to any other zone legal for it

Faction:

- **DWG — Boarding Party**: choose a friendly DWG faction ship; you may exchange
  it with one of your opponent's faction ships of equal or lesser cost from the
  same zone
- **OW — Change Order**: discard an OW vehicle card; draw a copy of a
  player-made ship or tank from your deck in two turns
- **LH — Flyby**: choose an LH vehicle card in hand; give it the Half-Cost and
  Temporary keywords

SS, WF, and GT have no faction power authored yet — those decks get only the 4
universal powers until new rows (and matching effect implementations) are added.

### 3.9 Card effects

Cards carry `meta` trigger keys mapping to named functions in the shared effect
registry (e.g. `onPlayEffect: 'marauderOnPlay'`), plus `additionalCopies` (spawn
extra copies, cap 10) and `costModifier`. Triggers: onPlayEffect,
playOnZoneEffect, playOnVehicleEffect, playOnCardEffect, onDeathEffect,
onActivate, onBattleEffect, onBattleVictory, onBattleDefeat. Effects implemented
in the old BE are ported; cards referencing unimplemented effect names play as
**vanilla** (effect skipped, note appended to game log). All ~120 seeded cards are
playable from day one.

`SET_ALERT_CARD` (per the old BE's comment) **shows the opponent the card being
played before its effect resolves** — used when a card's effect needs opponent
interaction to complete, e.g. an ability that forces a battle: the card is
revealed as "in progress" until the required battle/report resolves.

### 3.10 Custom cards (MVP)

Create-card form: name, vehicle type, blueprint cost (manual entry), card image
upload (Supabase Storage). Server-side rules: material cost = blueprint cost
rounded **up** to nearest 5k (then Half-Cost halves it for planes); auto-keywords
by type (plane → Half-Cost + Temporary; airship → Fragile); no custom card
text or effects. Custom cards are visible to all players (opponents see what hits
them) but only usable in their owner's decks. AI/built-in card costs are already
rounded down to 10k in the source data.

## 4. Data model (Postgres)

All tables have RLS enabled. `service_role` (edge functions, Studio) bypasses RLS.

### `profiles`
`id uuid PK → auth.users`, `username text unique not null`, `created_at`.
Created by trigger on auth signup (username from signup metadata).
RLS: everyone authed reads; owner updates own row.

### `cards`
`id uuid PK`, `name`, `is_built_in bool`, `owner_id uuid null → profiles`,
`faction text` (NEUTRAL/DWG/SS/LH/TG/OW/SD/WF/GT), `type text` (vehicle|ability),
`vehicle_type text null` (ship|airship|tank|plane|sub), `blueprint_cost int`,
`material_cost int`, `cp_cost int`, `card_text text`, `image_url text`,
`keywords jsonb` (string array), `meta jsonb` (triggers/effect names), `created_at`.
Built-ins seeded with deterministic UUIDs (upsert-safe re-seeding).
RLS: everyone authed reads all cards; no direct client writes (custom card
creation goes through an edge function; built-ins edited via Studio only).

### `decks`
`id uuid PK`, `owner_id → profiles`, `name`, `faction text not null`
(DWG|GT|LH|OW|SS|WF — the deck's base faction), `cards jsonb` (`{card_id: qty}`),
`created_at`, `updated_at`.
RLS: owner-only (all operations). Client-side validation for UX; authoritative
re-validation at game start.

### `hero_powers`
`id uuid PK`, `name`, `faction text` (NEUTRAL or a faction), `power_text`
(named to avoid the SQL type name), `cp_cost int`, `meta jsonb` (effect name
for the shared registry), `created_at`.
Seeded from old BE `heroPowers.js` with deterministic UUIDs.
RLS: everyone authed reads; edited via Studio only (like built-in cards).

### `lobbies`
`id uuid PK`, `host_id → profiles`, `name`, `status text` (open|starting|closed),
`settings jsonb` (`{zoneBiomes: [w|b|l ×3], baseHp, deckRules...}`),
`host_deck_id`, `guest_id uuid null`, `guest_deck_id uuid null`, `created_at`.
RLS: authed users read open lobbies + lobbies they're in; host inserts (own id);
join/leave/start arbitrated by edge function (prevents join races).

### `games`
`id uuid PK`, `lobby_id`, `player_a → profiles`, `player_b → profiles`,
`status text` (active|complete|abandoned), `winner_id uuid null`,
`turn_number numeric`, `active_player uuid`, `settings jsonb` (frozen from lobby),
`state jsonb` (public state: zones with per-side in-play card instances and base
HP, per-player materials/CP/hand-count/deck-count/used-hero-powers, active battle,
pending battle report, capped action log), `version int` (optimistic concurrency),
`created_at`, `updated_at`.
RLS: participants read; no direct client writes (edge function only).

### `game_players`
`game_id + player_id PK`, `hand jsonb` (card instances), `deck jsonb` (ordered
card instances), `updated_at`.
RLS: a player reads **only their own row** — opponent hands/deck order are
unreadable at the database level. No direct client writes.

### Storage
Bucket `card-images`: public read; authed upload restricted to a per-user folder;
2 MB limit; jpg/png/webp.

## 5. Edge functions (Deno, TypeScript)

| Function | Actions |
|---|---|
| `game-action` | `{gameId, actionType, actionBody}` — the entire in-game vocabulary: PLAY_CARD_TO_ZONE, PLAY_CARD_WITHOUT_TARGET, PLAY_CARD_TARGETING_CARD_ON_FIELD, PLAY_CARD_TARGETING_CARD_IN_HAND, SET_ALERT_CARD, MOVE_VEHICLE (Mobile keyword), ATTACK_ENEMY_BASE, ATTACK_ENEMY_FLEET, SUBMIT_BATTLE_REPORT, DECIDE_BATTLE_REPORT, USE_HERO_POWER, END_TURN, CONCEDE |
| `lobby-action` | JOIN, LEAVE, START (START validates both decks, rolls first player, builds initial game + game_players rows in one transaction) |
| `create-card` | Validates + applies custom-card rules (rounding, auto-keywords), inserts card |

`game-action` flow: authenticate JWT → load game + caller's private row (service
role) → check turn/legality via `shared/engine` → apply → write `games` with
`WHERE version = :expected` (retry-safe; conflicting concurrent move fails
cleanly) → write affected `game_players` rows. The dispatcher and validators live
in `shared/engine` as pure functions `(state, action) → newState | error`; the
edge function is a thin I/O wrapper. Known old-BE bugs (assignment-in-`find`,
end-turn card copy, misspelled roles, missing LH seed) are explicitly not ported.

## 6. Realtime

Supabase Realtime `postgres_changes`, RLS-authorized:

- `games` row (by id) → both participants; on event, invalidate TanStack Query cache and refetch.
- `game_players` own row → hand/deck updates.
- `lobbies` table → live lobby browser and "opponent joined" updates.

Payloads are treated as change notifications only (always refetch — avoids
payload-size limits and partial-state bugs). Reconnect = resubscribe + refetch;
persistent games mean a dropped connection never loses state. A **My Games** page
lists active games with a your-turn indicator.

## 7. Frontend

Routes: `/login`, `/signup`, `/` (home), `/cards` (browse by faction + create
custom), `/decks`, `/decks/:id` (builder), `/lobbies`, `/games`, `/game/:id`.

Deck builder: creating a deck starts with picking its base faction
(DWG/GT/LH/OW/SS/WF); the card pool then shows that faction + NEUTRAL + your
custom cards, with the faction's hero powers displayed alongside the deck.

Stack: Vite, React 18, TypeScript, react-router, TanStack Query, supabase-js,
Tailwind CSS v4 with a custom token layer.

Game board (`/game/:id`): 3 biome-styled zone panels across the middle (water /
beach / land art treatments), enemy bases + HP bars above, own bases below, hand
fanned at the bottom, materials/CP/turn indicator, scrollable action log, hero
power buttons. Modals: zone activation choice, fleet-battle vehicle selection,
spawn sheet, battle report entry, report approval. Drag-or-click to play cards
into legal zones (illegal zones visibly disabled with reason).

Theme: ocean/naval game feel — deep navy gradient background
(rgb(21,56,112)→rgb(14,41,84)), parchment card faces, Lobster display font, the
old repo's 20 SVG icons for keywords/resources/vehicle types, 280×430 card layout
with cost badge and keyword icon row, `shortHandNumber` formatting ("42k",
"1.20 M"). Desktop-first; usable but not optimized on mobile.

## 8. Testing

- `shared/engine` + `shared/effects`: built test-first with Vitest. Every action
  type, placement rule, keyword, battle-resolution threshold, hero power, and
  deck-validation rule gets unit tests, plus concurrency (version conflict) and
  edge cases (empty deck, destroyed base, frozen-game action rejection).
- Edge functions: thin wrappers — logic tested via shared; wrapper smoke-tested
  locally via `supabase functions serve`.
- Frontend: component tests for deck-builder validation UX and board legality
  display; otherwise manual two-browser playtesting each phase.

## 9. Build phases

1. **Foundation** — scaffold repo per §2, link git remote; Supabase: auth
   config, profiles + trigger, cards + hero_powers schema, seed all 6 factions'
   cards and all hero powers; login/signup UI.
2. **Cards & decks** — card browser, custom card creation (edge function +
   storage), deck builder with faction selection and live validation.
3. **Lobbies** — create/browse/join/start with settings (biomes, base HP), realtime lobby list.
4. **Game engine** — shared engine TDD (turn loop → placement → base attacks →
   battles/reports → hero powers (universal + faction) → card effects),
   `game-action` function, board UI, realtime game sync.
5. **Polish** — theme pass, reconnect robustness, My Games dashboard, concede/abandon handling.

Each phase ends playable/verifiable. Phase 4 is the largest and will get its own
detailed implementation plan.

## 10. Out of scope (future work)

Blueprint file upload/parsing, custom card effects/text, spectators, in-game
chat, rankings/matchmaking, admin UI, faction powers for SS/WF/GT, turn timers,
mobile-optimized layout, deck import/export.
