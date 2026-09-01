// Generates From The Depths `.customBattle` files from card-game state.
//
// Handing the FtD executable a path to one of these boots the game straight
// into that battle — no mod required. The game's own command-line reader
// (BrilliantSkies.Boot.FtdCommandLineReader.LoadFile) recognises the
// `.customBattle` extension and dispatches BootInstruction_LoadCustomBattleFileAndLaunch,
// which loads the file, starts the battle, closes the UI and unpauses.
//
// The schema below is transcribed from a file saved by FtD 4.2.x. Two things
// matter and are easy to break:
//
//   * `$type` discriminators are Newtonsoft TypeNameHandling metadata. They must
//     be reproduced byte-for-byte or the rules block fails to deserialise.
//   * Blueprint references are portable logical paths ("Built In/Neter/DWG/Marauder"),
//     not filesystem paths — no drive, no extension. That is what makes it safe
//     to generate these server-side for a machine we know nothing about.

import { FACTIONS } from './gameSettings.ts'

/** Root of the blueprints FtD ships with, as they are addressed inside a battle file. */
export const BUILT_IN_BLUEPRINT_ROOT = 'Built In/Neter'

/**
 * Factions with a blueprint folder under `Built In/Neter`.
 *
 * Keyed by string rather than Faction because game state carries `faction` as a
 * plain string (SnapshotCard), and widening here beats casting at every call site.
 */
const BLUEPRINT_FOLDERS: Record<string, string> = {
  [FACTIONS.DWG]: 'DWG',
  [FACTIONS.GT]: 'GT',
  [FACTIONS.LH]: 'LH',
  [FACTIONS.OW]: 'OW',
  [FACTIONS.SS]: 'SS',
  [FACTIONS.TG]: 'TG',
  [FACTIONS.WF]: 'WF',
  [FACTIONS.SD]: 'SD',
}

/**
 * Cards whose display name does not match the blueprint file that backs them.
 *
 * Keyed "<card faction>/<card name>", valued with a path relative to `Built In/Neter`.
 * These are not typos to fix in the card data — the game's own filenames are the
 * inconsistent side (Bucanneer, Harbinger), and several cards deliberately carry a
 * "[GT] "/"[TG] " prefix the files do not.
 *
 * This lives here rather than on the cards because game state (SnapshotCard) has no
 * blueprintId field to carry. If one is ever added, `resolveBlueprintPath` already
 * prefers it and these entries can move into the seed data.
 *
 * Keep in step with `scripts/verify-blueprint-mapping.mjs`, which reads this map and
 * fails if any vehicle card resolves to a file that is not in the install.
 */
export const BLUEPRINT_OVERRIDES: Record<string, string> = {
  'DWG/Land Marauder': 'DWG/Land_Marauder',
  'DWG/Buccaneer': 'DWG/Bucanneer',
  'DWG/Flying Squirrel': 'DWG/FlyingSquirrel',
  'SS/Falcon Squadron': 'SS/Falcon_Squadron',
  'WF/Earth Raker': 'WF/EarthRaker',
  'WF/Harbringer': 'WF/Harbinger',
  'OW/The Onyx Throne': 'OW/OnyxThrone',
  'OW/Jormangund': 'OW/Jormungand',
  'TG/[TG] Amusement': 'TG/Amusement',
  'TG/[TG] Fear': 'TG/Fear',
  'TG/[TG] Hysteria': 'TG/Hysteria',
  'TG/[TG] Obsession': 'TG/Obsession',
  'GT/[GT] Zephyr': 'GT/Zephyr',
  'GT/[GT] Osprey': 'GT/Osprey',
  'GT/[GT] Achievement': 'GT/Achievement',
  'GT/[GT] Kobold': 'GT/Kobold',
  'GT/[GT] Monsoon': 'GT/Monsoon',
  'GT/[GT] Hunchback': 'GT/Hunchback',
  // Two cross-faction ones. Both blueprints live in GT/ despite the card's faction —
  // worth a look when you next touch the card data, but the paths below are correct.
  'OW/[GT] Damacy': 'GT/Damacy',
  'TG/Obelisk': 'GT/Obelisk',
}

/** The subset of a card this module needs. Keeps the signature independent of SeedCard/DB rows. */
export interface BattleCard {
  name: string
  faction: string
  /**
   * Explicit blueprint path, relative to `Built In/Neter` (e.g. "DWG/Land_Marauder").
   * Set this whenever the card's display name does not match the blueprint filename —
   * the game ships several that differ (Buccaneer → Bucanneer, Jormangund → Jormungand,
   * The Onyx Throne → OnyxThrone, Land Marauder → Land_Marauder, Flying Squirrel → FlyingSquirrel).
   */
  blueprintId?: string | null
}

export interface BattleTeamInput {
  name: string
  cards: BattleCard[]
  /** Exactly one team should be the player's, or the match runs as a spectated AI fight. */
  isPlayerTeam?: boolean
}

export class BlueprintResolutionError extends Error {
  // Declared and assigned by hand rather than written as a `readonly card`
  // parameter property: frontend/tsconfig.app.json sets erasableSyntaxOnly and
  // typechecks all of shared/, and parameter properties are not erasable (TS1294).
  readonly card: BattleCard

  constructor(card: BattleCard) {
    super(
      `Card "${card.name}" (faction ${card.faction}) has no blueprint folder for its faction ` +
        `and no explicit blueprintId. Set blueprintId to a path relative to ${BUILT_IN_BLUEPRINT_ROOT}.`,
    )
    this.name = 'BlueprintResolutionError'
    this.card = card
  }
}

/**
 * Resolve a card to the logical blueprint path FtD expects.
 *
 * Precedence: explicit `blueprintId`, then BLUEPRINT_OVERRIDES, then faction + name.
 * Derivation is deliberately literal — no slugging — because the game's filenames are
 * inconsistent, so a card that does not match its file must be listed rather than guessed.
 */
export function resolveBlueprintPath(card: BattleCard): string {
  if (card.blueprintId) {
    return `${BUILT_IN_BLUEPRINT_ROOT}/${stripLeadingSlash(card.blueprintId)}`
  }
  const override = BLUEPRINT_OVERRIDES[`${card.faction}/${card.name}`]
  if (override) return `${BUILT_IN_BLUEPRINT_ROOT}/${override}`

  const folder = BLUEPRINT_FOLDERS[card.faction]
  if (!folder) throw new BlueprintResolutionError(card)
  return `${BUILT_IN_BLUEPRINT_ROOT}/${folder}/${card.name}`
}

function stripLeadingSlash(p: string): string {
  return p.replace(/^\/+/, '')
}

// --- File shape -------------------------------------------------------------

interface CustomBattleBlueprintJson {
  _fileName: string
  IsInFtd: boolean
  SpawnAngle: number
  SpawnAltitude: number
  FileName: string
}

interface CustomBattleTeamJson {
  Blueprints: CustomBattleBlueprintJson[]
  Name: string
  IsPlayerTeam: boolean
  DefaultName: boolean
  MaxBlueprintsPerRow: number
  RowSpacing: number
  ColumnSpacing: number
  FleetColors: string[]
  StartingMaterial: number
}

export interface CustomBattleFile {
  Teams: CustomBattleTeamJson[]
  Rules: unknown
  BlueprintSpawnAngleDefault: number
  BlueprintSpawnAltitudeDefault: number
  BoardSectionEast: number
  BoardSectionNorth: number
  SymmetricMaterial: boolean
  MaterialsPerTeam: number
  ResourceDrop: number
  SpawnDistanceBetweenTeams: number
}

const NEUTRAL_FLEET_COLORS = ['0,0,0,0', '0,0,0,0', '0,0,0,0', '0,0,0,0']

/**
 * Default rules block, transcribed verbatim from a battle saved in game.
 *
 * Do not hand-edit the `$type` strings. If you need different rules, set them up
 * in game, save, and re-transcribe — that is cheaper than debugging a
 * deserialisation failure with no error message.
 */
function defaultRules(): unknown {
  const timeLimit = {
    $type: 'BrilliantSkies.Ui.CustomBattleMode.CustomBattleRules+TimeLimitRule, Ftd',
    Name: 'Time limit', Min: 1.0, Max: 86400.0, Increment: 1.0,
    Initial: 300.0, Unit: 's', Value: 300.0, Enabled: false,
  }
  const maxAltitude = {
    $type: 'BrilliantSkies.Ui.CustomBattleMode.CustomBattleRules+MaxAltitudeRule, Ftd',
    Name: 'Maximum altitude', Min: -10000.0, Max: 10000.0, Unit: 'm',
    PenaltyPointsPerSecond: 1.0, Increment: 0.1, Value: 0.0, Initial: 0.0, Enabled: false,
  }
  const minAltitude = {
    $type: 'BrilliantSkies.Ui.CustomBattleMode.CustomBattleRules+MinAltitudeRule, Ftd',
    Name: 'Minimum altitude', Min: -10000.0, Max: 10000.0, Unit: 'm',
    PenaltyPointsPerSecond: 1.0, Increment: 0.1, Value: 0.0, Initial: 0.0, Enabled: false,
  }
  const maxDistance = {
    $type: 'BrilliantSkies.Ui.CustomBattleMode.CustomBattleRules+MaxDistanceRule, Ftd',
    Name: 'Maximum distance', Min: 0.0, Max: 10000.0, Unit: 'm',
    PenaltyPointsPerSecond: 1.0, Increment: 0.1, Value: 0.0, Initial: 0.0, Enabled: false,
  }
  const maxSpeed = {
    $type: 'BrilliantSkies.Ui.CustomBattleMode.CustomBattleRules+MaxSpeedRule, Ftd',
    Name: 'Maximum speed', Min: 0.0, Max: 10000.0, Unit: 'm/s',
    PenaltyPointsPerSecond: 1.0, Increment: 0.1, Value: 0.0, Initial: 0.0, Enabled: false,
  }
  const tooDamaged = {
    $type: 'BrilliantSkies.Ui.CustomBattleMode.CustomBattleRules+TooDamagedRule, Ftd',
    Name: 'Too damaged', Initial: 0.55, Value: 0.55, Enabled: true,
  }
  const damagedAndSinking = {
    $type: 'BrilliantSkies.Ui.CustomBattleMode.CustomBattleRules+DamagedAndSinkingRule, Ftd',
    Name: 'Damaged and sinking', Initial: 0.8, Value: 0.8, Enabled: true,
  }
  const sustainedByRepairs = {
    $type: 'BrilliantSkies.Ui.CustomBattleMode.CustomBattleRules+SustainedByRepairsRule, Ftd',
    Name: 'Sustained by repairs', Initial: 100.0, Value: 100.0, Enabled: true,
  }

  return {
    PointsCountType: 1,
    DisqualificationRulesEnabled: true,
    PenaltyPointsBeforeDisqualified: 30.0,
    TimeLimit: timeLimit,
    // Spelled "MaxAlittude" in the game's own serialised output. Not a typo here.
    MaxAlittude: maxAltitude,
    MinAltitude: minAltitude,
    MaxDistance: maxDistance,
    MaxSpeed: maxSpeed,
    TooDamaged: tooDamaged,
    DamagedAndSinking: damagedAndSinking,
    SustainedByRepairs: sustainedByRepairs,
    GeneralRules: [timeLimit],
    DisqualificationRules: [maxAltitude, minAltitude, maxDistance, maxSpeed],
    CleanUpRules: [tooDamaged, damagedAndSinking, sustainedByRepairs],
  }
}

export interface BuildCustomBattleOptions {
  /** Metres between the two teams' spawn points. Game default is 1000. */
  spawnDistanceBetweenTeams?: number
  /** Starting material per team. 0 disables resource play. */
  materialsPerTeam?: number
}

/**
 * Build a `.customBattle` file object from the vehicles each side brought.
 *
 * Ability cards must be filtered out before calling — only vehicle cards have blueprints.
 */
export function buildCustomBattle(
  teams: BattleTeamInput[],
  options: BuildCustomBattleOptions = {},
): CustomBattleFile {
  if (teams.length < 2) {
    throw new Error(`A custom battle needs at least 2 teams, got ${teams.length}.`)
  }

  return {
    Teams: teams.map((team) => ({
      Blueprints: team.cards.map((card) => {
        const path = resolveBlueprintPath(card)
        // _fileName is the serialised backing field, FileName the property.
        // The game writes both; both are kept in sync here.
        return {
          _fileName: path,
          IsInFtd: true,
          SpawnAngle: 0.0,
          SpawnAltitude: 0.0,
          FileName: path,
        }
      }),
      Name: team.name,
      IsPlayerTeam: team.isPlayerTeam ?? false,
      DefaultName: false,
      MaxBlueprintsPerRow: 100,
      RowSpacing: 200.0,
      ColumnSpacing: 200.0,
      FleetColors: NEUTRAL_FLEET_COLORS,
      StartingMaterial: 0.0,
    })),
    Rules: defaultRules(),
    BlueprintSpawnAngleDefault: 0.0,
    BlueprintSpawnAltitudeDefault: 0.0,
    BoardSectionEast: 0.0,
    BoardSectionNorth: 0.0,
    SymmetricMaterial: true,
    MaterialsPerTeam: options.materialsPerTeam ?? 0.0,
    ResourceDrop: 0.0,
    SpawnDistanceBetweenTeams: options.spawnDistanceBetweenTeams ?? 1000.0,
  }
}

/** Serialise to the exact on-disk form: compact JSON, no trailing newline. */
export function serializeCustomBattle(file: CustomBattleFile): string {
  return JSON.stringify(file)
}
