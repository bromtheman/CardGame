// Single source of truth for every tunable game rule (spec §3).

export const STARTING_HAND_SIZE = 5
export const STARTING_CP_AMOUNT = 3
export const DECK_SIZE = 20
export const UNIQUE_COPY_LIMIT = 2
export const PLAYER_CARD_LIMIT = 4 // max custom cards per deck
export const FLIER_COPY_LIMIT = 6 // max plane+airship copies per deck
export const SUB_COPY_LIMIT = 6

export const DEFAULT_BASE_HP = 1000
export const MATERIALS_PER_TURN = 50_000 // × floor(turnNumber)
export const BASE_DAMAGE_DIVISOR = 1000 // base dmg = floor(materialCost / this)

export const SPAWN_DISTANCE_DEFAULT_M = 1200
export const SPAWN_DISTANCE_MIN_M = 50
export const SPAWN_DISTANCE_MAX_M = 2000
export const HERO_POWER_DISTANCE_MOD_M = 600
export const IN_BATTLE_RESOURCE_RATE = 0.1

export const SURVIVE_HP_PERCENT = 90
export const REPAIR_WINDOW_MIN_PERCENT = 80
export const REPAIR_COST_RATE = 0.5

export const CUSTOM_CARD_ROUND_TO = 5000 // player cards round UP to this
export const MAX_CUSTOM_BLUEPRINT_COST = 10_000_000
export const CARD_IMAGE_MAX_BYTES = 2_097_152 // must match the storage bucket limit
export const CARD_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const FACTIONS = {
  NEUTRAL: 'NEUTRAL', DWG: 'DWG', SS: 'SS', LH: 'LH', TG: 'TG',
  OW: 'OW', SD: 'SD', WF: 'WF', GT: 'GT',
} as const

// Factions a deck may use as its base (spec §3.1)
export const DECK_FACTIONS = ['DWG', 'GT', 'LH', 'OW', 'SS', 'WF'] as const

export const CARD_TYPES = { VEHICLE: 'vehicle', ABILITY: 'ability' } as const

export const VEHICLE_TYPES = {
  SHIP: 'ship', AIRSHIP: 'airship', TANK: 'tank', PLANE: 'plane', SUB: 'sub',
} as const

export const ZONE_TYPES = { WATER: 'water', BEACH: 'beach', LAND: 'land' } as const

export const KEYWORDS = {
  AIR_SCREEN: 'airScreen', SUB_SCREEN: 'subScreen', BLOCKER: 'blocker',
  SCRAPPY: 'scrappy', TEMPORARY: 'temporary', INOFFENSIVE: 'inoffensive',
  HALF_COST: 'halfCost', FRAGILE: 'fragile', STEALTHY: 'stealthy',
  MOBILE: 'mobile', ROBOTIC: 'robotic',
} as const

export const TRIGGERS = {
  ON_PLAY: 'onPlayEffect', PLAY_ON_ZONE: 'playOnZoneEffect',
  PLAY_ON_VEHICLE: 'playOnVehicleEffect', PLAY_ON_CARD: 'playOnCardEffect',
  ON_DEATH: 'onDeathEffect', ON_BATTLE_EFFECT: 'onBattleEffect',
  ON_BATTLE_VICTORY: 'onBattleVictory', ON_BATTLE_DEFEAT: 'onBattleDefeat',
  ON_ACTIVATE: 'onActivate',
} as const

export const ZONE_COUNT = 3
export const MAX_ZONE_BASE_HP = 10_000_000
export const MAX_CUSTOM_CARDS_PER_PLAYER = 50

export const LOG_MAX_ENTRIES = 200 // capped action log (spec §3) — oldest entries drop first

export const ADDITIONAL_SPAWNS_CAP = 10
export const DOUBLE_UP_MAX_COST = 400_000
// All for the Cause: "If the vehicle costed more than 250k, summon two
// instead." Printed materialCost, strictly greater — the same authority every
// other pool and threshold filter reads.
export const ALL_FOR_THE_CAUSE_DOUBLE_COST = 250_000
export const RESERVES_CARD_COUNT = 3
export const CHANGE_ORDER_DELAY_TURNS = 2

export const RHEA_MAX_PLANE_COST = 300_000 // Rhea: "base cost under 300k" (exclusive)
export const GT_HEAVY_AIRSHIP_MIN_COST = 400_000 // spec §7.3: the GT airship cost cliff

export const MARAUDER_DISCOUNT = 50_000  // Marauder: enemy vehicle costs 50k less
export const EXCALIBUR_COST_DELTA = -200_000 // Excalibur: AI ship in hand costs 200k less
export const REPAIRMEN_READY_DRAW_MAX_COST = 200_000 // Repairmen Ready draws below this

export const FLYING_SQUIRREL_ATTACK_COUNT = 3 // Flying Squirrel Attack: target fights this many summons
export const MARTYR_ATTACK_COUNT = 4          // Martyr Attack: base summon count
export const MARTYR_ATTACK_BOOSTED_COUNT = 6  // Martyr Attack: target is an airship, or a 400k+ player design
export const MARTYR_ATTACK_BOOST_MIN_COST = 400_000
export const AIR_STRAFE_PREDATOR_COUNT = 2    // Air Strafe: PredatorX summons (always); +1 chosen hull vs a player design

// Catshark: "gain 30k resources this turn". No rider expires it — endTurn sets
// the incoming side's materials to floor(turnNumber) * MATERIALS_PER_TURN
// outright, so the grant lasts exactly until that side's next turn begins.
export const CATSHARK_MATERIALS = 30_000

// Human-readable names for the seven hero powers, used wherever a power id
// is shown to a player (Kraken's refresh choice).
export const HERO_POWER_LABELS: Record<string, string> = {
  salvage: 'Salvage',
  tacticalPositioning: 'Tactical Positioning',
  draw: 'Draw',
  rapidRedeployment: 'Rapid Redeployment',
  boardingParty: 'Boarding Party',
  changeOrder: 'Change Order',
  flyby: 'Flyby',
}
