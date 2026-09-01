# Reporting FtD battle results back to the site

**Status:** built, not yet deployed. Companion to
[2026-09-01-battle-launch.md](2026-09-01-battle-launch.md), which covers the
outbound half (generating a `.customBattle` and opening it in the game).

## What we're building

The outbound half already works: a player clicks "Fight in FtD" and the game
opens with both fleets spawned. The return half was a person reading HP numbers
off the screen and typing them into `BattleOverlay`. A C# mod inside From The
Depths now reads the outcome at battle end and posts it to the site, which
**prefills** the report form.

**It prefills. It does not submit, and it never approves.** That distinction is
the whole design, and the reason to read the risk section before changing
anything here.

## The one thing that makes this safe

The server cannot verify that a fight happened. It could not before this change
either — a player typing "100%" into the overlay is exactly as unverifiable as a
mod posting `aliveFraction: 1.0`. Nothing was added to the threat model and
nothing was taken away from the defence, which is one line in
`shared/engine/battleResolve.ts`:

```ts
if (actor === report.submittedBy) return err(403, 'The other captain must approve your report')
```

A human still presses Submit on numbers they have looked at, and the OTHER
captain still approves. **Do not extend `battle-report` into submitting or
approving.** A token that could do either would turn a convenience into a way to
resolve a battle unilaterally.

Two consequences that fell out of choosing prefill over auto-submit, both good:

* **Repairs survive.** `SUBMIT_BATTLE_REPORT` freezes `repairs` into
  `pendingReport`, and only the *approver* gets a second list
  (`DECIDE_BATTLE_REPORT.repairs`). An auto-submitting mod would have silently
  cost the submitting captain their paid repair picks, because it has no idea
  what a player wants to spend materials on.
* **`shared/engine/` is untouched.** No new action type, so
  `battleFreeze.test.ts`'s sweep over `knownActionTypes()` still covers
  everything, and the two freezes behave exactly as they did.

## Shape

```
browser  --issue-->  battle-report      mints a single-use token
browser  builds the .customBattle with a CardGame block carrying that token
player   opens the file, fights
FtD mod  --submit--> battle-report      stores a PREFILL (no session needed)
browser  --fetch-->  battle-report      overlay offers "Fill in the report"
player   presses Submit  -->  game-action  SUBMIT_BATTLE_REPORT
opponent presses Approve -->  game-action  DECIDE_BATTLE_REPORT
```

### Why one file and not two

The identity rides **inside** the `.customBattle` as a top-level `CardGame`
member. FtD's Newtonsoft reader ignores members it does not know, so the game
loads it unchanged.

The alternative was a sidecar `.json` downloaded alongside. It was rejected for a
specific reason, not a stylistic one: a second `a.click()` from the same page
raises Chrome's **"Download multiple files"** permission prompt. A player who
clicks Block gets no sidecar, no error, and a mod with no token — and the
`.customBattle` is the only path FtD's command-line reader hands the mod anyway,
so the sidecar would have to be found by directory convention.

The cost of embedding is one test amendment: `customBattle.test.ts`'s parity
test used to assert the generated top-level keys equal a real saved file's.
It now compares through `schemaKeysOf`, which excludes `CardGame` **by name** —
so every other key must still match the save exactly and a second stowaway key
still fails the suite.

### The (team, vehicle) → instanceId map

The mod knows a hull as `(teamIndex, vehicleIndex)` and by name. Name cannot
work: two Marauders collide. So `CardGame.Teams[i].Vehicles[j]` describes
`Teams[i].Blueprints[j]`, and that pairing is **structural** — both are
`team.cards[j]` from the array `battleTeams()` returned, mapped in
`buildCardGameBlock`. Filter one list and not the other and it breaks; a test in
`battleTeams.test.ts` builds a real file from a real battle state and walks both
lists to pin it.

The aggressor-first ordering in `battleTeams.ts` is load-bearing for the same
reason: the mod reports a winning TEAM index, and `sideForTeamIndex` turns index
0 into the aggressor's side.

## Auth: what a client with no Supabase session needs

`game-action`, `lobby-action` and `create-card` all authenticate the same way —
`auth.getUser()` against the caller's JWT, then a membership check. A mod has no
Supabase session and must never be given one: a user access token is a
full-power account credential, and this one is written in clear text into the
player's Downloads folder inside a file they may hand to someone else.

So `battle-report` has two auth models in one function:

| op | caller | auth |
|---|---|---|
| `issue` | browser | user JWT + membership check, same as `game-action` |
| `fetch` | browser | user JWT + membership check |
| `submit` | the mod | the token alone — `auth.getUser()` is never called |

The token is 32 random bytes, base64url. **Only its SHA-256 is stored**, so a
database leak yields nothing redeemable. Four things bound it:

* single use — the conditional UPDATE inside `redeem_battle_token` is the mutex,
  the same pattern `lobby-action`'s START lock uses;
* short lived — `BATTLE_TOKEN_TTL_MS`, 12 hours;
* one battle — `battleKeyOf` fingerprints zone + aggressor + both id lists, and
  the function recomputes it from the live `games` row and refuses a mismatch;
* one verb — it can store a prefill and nothing else.

`issue` also retires that player's earlier unredeemed tokens for the game, so at
most one live credential exists per player per game.

**Every token failure answers identically** — unknown, expired, used, wrong
game, wrong battle all get one opaque 401 with one sentence, so an
unauthenticated caller cannot probe which tokens exist. The sentence is still
written for a player, because the mod shows it in an in-game popup.

Everything is validated **before** the token is redeemed, so a report that
cannot land does not burn the player's one credential and strand them.

## HP mapping: direct, despawned = 0

`hpFromVehicle` in `shared/battleReport.ts`:

```
hp = exists === false ? 0 : clamp(round(aliveFraction * 100), 0, 100)
```

⚠ **A known, accepted sharp edge.** FtD's own cleanup rules — written by
`defaultRules()` in `customBattle.ts` as `TooDamaged: 0.55` and
`DamagedAndSinking: 0.8` — remove a hull from the world well before its alive
fraction reaches zero. A hull the game despawned therefore lands at **0**, not
somewhere in the repair band (`REPAIR_WINDOW_MIN_PERCENT` 80 ..
`SURVIVE_HP_PERCENT` 90), and a captain who would have paid to repair it sees a
wreck instead.

This is harmless *precisely because* the prefill is advisory: a human reads the
numbers, adjusts the ones the game rounded off, and presses Submit. The banner in
`BattleOverlay` says so in as many words. **Do not "fix" it by inventing a floor
for despawned hulls** — that would guess at a number the players can just look at.

## Files

| File | What it does |
|---|---|
| `shared/battleReport.ts` | `battleKeyOf`, `hpFromVehicle`, `buildPrefillResults`, `sideForTeamIndex`, the TTL and wire version. Imports **nothing** |
| `shared/battleReport.test.ts` | 23 cases over all of the above |
| `shared/customBattle.ts` | `CardGameJson` types; `instanceId` on `BattleCard`, `side` on `BattleTeamInput`; `buildCardGameBlock` |
| `supabase/migrations/20260901222000_create_battle_tokens.sql` | `battle_tokens` + `redeem_battle_token` |
| `supabase/functions/battle-report/index.ts` | the three ops |
| `frontend/src/pages/game/ftdPrefill.ts` | pure: merging a reported result onto the form |
| `frontend/src/pages/game/ftdReporting.ts` | the network half (`issue`, the `fetch` poll) |
| `scripts/smoke-battle-report.mjs` | the only thing that can test the function at all |

### Why `battle-report` syncs ONE shared file

`shared-manifest.json` gives it `["battleReport.ts"]`. It dispatches no action,
so it needs neither the handler nor the effect registry, and CLAUDE.md's
"consumers import `shared/engine/index.ts`" rule — which exists for those
registries — does not apply. Keeping `battleReport.ts` dependency-free is what
buys that: it reads a battle's identity off plain JSON fields rather than
through `battleParticipants`.

The corollary is that **`battle-report` does not know the battle's roster** and
does not try to. `SUBMIT_BATTLE_REPORT` already refuses a report that does not
cover exactly `battleParticipants`; re-implementing that check here would mean
copying the engine's 25 modules to catch something already caught. A reported id
that is not in the battle simply prefills nothing —
`applyPrefill` drops it and says so.

`shared/customBattle.ts` is still **not** in the manifest: the browser builds the
battle file, the server only mints the token.

## Testing

- `shared/battleReport.test.ts` (23) and `frontend/src/pages/game/ftdPrefill.test.ts`
  (13) are new; `customBattle.test.ts` (+6) and `battleTeams.test.ts` (+4) grew.
- `supabase/seed/functionSharedSync.test.ts` generates one case per manifest
  entry, so it goes 33 → **34**. That delta is expected, not a regression.
- ⚠ **`battle-report/index.ts` is covered by nothing automated.** The root
  tsconfig's `include` is `["shared","supabase/seed"]`, so `npx tsc` never reads
  it, and there is no Deno harness in this repo — the same hole
  `game-action`'s catalog probe sits in. `scripts/smoke-battle-report.mjs` is
  the substitute and must actually be run after deploying. It proves the four
  things only a live run can: that a caller with **no Supabase session** can
  submit, that the token is single use, that every token failure looks
  identical, and — the important one — that the prefilled numbers satisfy a real
  `SUBMIT_BATTLE_REPORT` unedited, which is the coverage rule this function
  deliberately does not enforce itself.

## Deploy order

The migration and the function must both be live before any browser calls
`issue`, and Netlify ships the frontend on a push to `main`.

1. Apply `20260901222000_create_battle_tokens.sql` (merging to `main` does it;
   if applied through MCP `apply_migration`, write the filename back to the
   version MCP recorded — `list_migrations`).
2. `npm run functions:deploy -- battle-report` (add `--dry-run` first). Not the
   `deploy_edge_function` MCP tool: a truncated payload deletes what it omits.
3. `node scripts/smoke-battle-report.mjs`.
4. Only then push the frontend.

## Open questions

- **Nobody has run the mod against this yet.** The wire format is fixed and the
  server side is tested end to end by the smoke script, but the first real
  exchange with C# will find something.
- **Expired rows accumulate.** `battle_tokens` has no reaper. Rows are small and
  cascade-delete with their game; if it ever matters, a `delete from
  battle_tokens where expires_at < now() - interval '7 days'` on a schedule is
  the whole fix.
- **Both captains can mint a token for the same battle.** The second `submit`
  gets a clean 409 saying a report is already pending, which is right — but only
  one of them is running the fight, so in practice only one ever posts.
- **The overlay polls** (`FTD_RESULT_POLL_MS`, 15s) rather than using realtime.
  `battle_tokens` is not in the realtime publication and has no RLS policy, both
  deliberately, so `useRealtimeInvalidate` is not open to it.
