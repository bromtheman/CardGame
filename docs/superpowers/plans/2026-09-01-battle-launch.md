# Launching FtD battles from the site

**Status:** generator, blueprint mapping and the in-game export button are all done.
Remaining: run one match end to end.

## What we're building

A player finishes setting up a match on the site, clicks one thing, and From The
Depths opens with both sides' vehicles already spawned in a custom battle. Battle
results are reported back manually for now — nothing reads the outcome.

## Why there is no mod

The game already does the hard part. `BrilliantSkies.Boot.FtdCommandLineReader.LoadFile`
recognises four file types passed as command-line arguments — `.blueprint`, `.txt`,
`.customBattle`, `.json` — and a `.customBattle` path dispatches
`BootInstruction_LoadCustomBattleFileAndLaunch`, whose `Run()` loads the file, inits
and starts the battle, closes all UIs and unpauses.

```
"…\From The Depths.exe" "…\match.customBattle"
```

So the whole feature reduces to: generate the right file, and get the OS to open it
with the game.

The blueprints are the ones shipped with the game (`StreamingAssets\Blueprints\Neter`),
and — critically — a battle file addresses them by **portable logical path**
(`Built In/Neter/DWG/Marauder`), with no drive letter and no extension. That is what
makes server-side generation safe: the same file works on any install, on any drive.

## What's in the repo now

| File | What it does |
|---|---|
| `shared/customBattle.ts` | Builds a `.customBattle` file object from teams of cards |
| `shared/customBattle.test.ts` | Unit tests + parity tests against a real game-saved file |
| `shared/fixtures/game-saved.customBattle` | A battle saved by FtD 4.2.x — the schema source of truth |
| `scripts/verify-blueprint-mapping.mjs` | Checks every vehicle card resolves to a real blueprint file |
| `scripts/register-custombattle-association.ps1` | One-time per-player file association (HKCU, no admin) |
| `frontend/src/pages/game/LaunchInFtdButton.tsx` | "Fight in FtD" button, rendered by `BattleOverlay` |
| `frontend/src/pages/game/battleTeams.ts` | Turns the active battle into the two fleets, with costs/types/roles |

`shared/customBattle.ts` is not in `supabase/functions/shared-manifest.json`. Add it
there and run `npm run functions:sync` only if an edge function needs to generate
battle files server-side.

## Launch mechanism

**v1 — download and open.** The site generates the file and hands it to the browser as
a download; the player double-clicks it. Setup is one run of
`register-custombattle-association.ps1`. No native code to build, sign, or get past
SmartScreen.

**v2 — one click.** Register an `ftd://` URI scheme pointing at a small helper that
writes the file and launches the game. Strictly nicer, but it means shipping an
executable to every player. Not worth it before v1 proves the pipeline.

## How the fight is staged

Four things the generated file sets up, so the fight matches the spawn sheet the
overlay already shows the players:

| | Value | Why |
|---|---|---|
| Aircraft altitude | `SpawnAltitude: 80` for planes and airships | Spec §3.5's spawn sheet. Everything else spawns at the surface. |
| Attacker heading | `SpawnAngle: 180` on the aggressor's hulls | Both fleets otherwise spawn facing the same way. Turning the attacker around leaves the defenders already pointed at it — the advantage defending is meant to carry. |
| In-battle resources | `StartingMaterial` per team = its own fleet's full build cost | Deliberately **not** spec §3.5's 10% per vehicle, which the overlay's spawn sheet still quotes for a hand-run match. FtD pools material per team rather than per craft, and a tenth spread across a whole fleet was too small to spend. Uses the effective cost, so a Half Cost hull contributes its halved figure. |
| Material symmetry | `SymmetricMaterial: false` | The one value that deliberately differs from the saved fixture — the two teams' pools are derived from their own fleets, so they genuinely differ. |

## Open questions

- **Which side is the player's? — decided: neither.** `buildCustomBattle` leaves
  every team `IsPlayerTeam: false`, so the match runs as a spectated AI fight.
  That is deliberate, not a default left unexamined: the two captains play the card
  game over Discord and run the fight on *one* of their machines. There is no "my
  side" to command, and it does not matter which of them downloads the file — so
  both see the button, and neither is marked the player.
- **Card-to-blueprint gaps.** Several cards don't match their blueprint filename.
  These are handled by `BLUEPRINT_OVERRIDES` in `shared/customBattle.ts` rather than
  by a per-card `blueprintId`. All 22 override keys match a real seeded card, but the
  *targets* have never been checked against an install — `node scripts/verify-blueprint-mapping.mjs`
  on a machine with the game is what confirms that. A sample:

  | Card | Blueprint path |
  |---|---|
  | Land Marauder | `DWG/Land_Marauder` |
  | Buccaneer | `DWG/Bucanneer` (the game ships it misspelled) |
  | Flying Squirrel | `DWG/FlyingSquirrel` |
  | The Onyx Throne | `OW/OnyxThrone` |
  | Jormangund | `OW/Jormungand` |
  | `[GT] …` cards | resolve against the `GT/` folder; names carry a `[GT] ` prefix the files don't |

- **Rules.** The generated rules block is transcribed verbatim from the saved file
  (5 minute time limit disabled, disqualification on, standard cleanup rules). If the
  card game wants different match rules, set them up in game, save, and re-transcribe
  rather than hand-editing the `$type` discriminators.

## Next steps

1. **Spawn distance.** The generator writes the site's distance into
   `SpawnDistanceBetweenTeams` — verified by dumping a file — and the top-level keys
   match a real save exactly, so if the game still spawns at its own default the field
   is not the one FtD reads on load. Re-check against a freshly generated file before
   chasing it further.
2. Run `node scripts/verify-blueprint-mapping.mjs` on a machine with the game installed
   and confirm every override target resolves to a real file.
3. Register the association once (`scripts/register-custombattle-association.ps1`), then
   download a battle from the site and check it opens the game.
4. Play one match end to end and confirm the vehicles that spawn match the cards played,
   and that the staging table above holds: aircraft at 80 m, the attacking fleet facing
   away, and each team holding its own material pool.
5. Check the transparent `FleetColors` (`'0,0,0,0'`) look right in game. Along with
   `SymmetricMaterial`, it is one of the few values not transcribed from a real save.
