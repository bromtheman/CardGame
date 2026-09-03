// Single source of truth for every tunable game rule (spec §3).

export const STARTING_HAND_SIZE = 5
export const STARTING_CP_AMOUNT = 3
export const DECK_SIZE = 20
export const UNIQUE_COPY_LIMIT = 2
export const PLAYER_CARD_LIMIT = 4 // max custom cards per deck
export const FLIER_COPY_LIMIT = 6 // max plane+airship copies per deck
export const SUB_COPY_LIMIT = 6

export const DEFAULT_BASE_HP = 1000
// × floor(turnNumber). The default only applies when the lobby carries no
// `materialsPerTurn` override — read it through `materialsPerTurnOf`
// (lobbySettings.ts), never straight from this constant.
export const MATERIALS_PER_TURN = 75_000
// Floor is CUSTOM_CARD_ROUND_TO: below the cheapest possible card cost, turn 1
// could not buy anything at all. Ceiling matches the other big-number caps.
export const MIN_MATERIALS_PER_TURN = 5_000
export const MAX_MATERIALS_PER_TURN = 10_000_000
export const BASE_DAMAGE_DIVISOR = 1000 // base dmg = floor(materialCost / this)

export const SPAWN_DISTANCE_DEFAULT_M = 1200
export const SPAWN_DISTANCE_MIN_M = 50
export const SPAWN_DISTANCE_MAX_M = 2000
export const HERO_POWER_DISTANCE_MOD_M = 600
// Ongoing Attrition: "deal 40k damage to the enemy base ... for each vehicle
// you have in the zone more than your opponent". Materials, like every other
// base-damage figure — it converts through BASE_DAMAGE_DIVISOR (design spec
// §3.4), so one surplus vehicle costs 40 of a default 1000 HP base.
export const ONGOING_ATTRITION_DAMAGE_PER_VEHICLE = 40_000

// TG Vengeful: "deals 40k damage to the enemy base in this zone". Its OWN
// constant rather than a reuse of ONGOING_ATTRITION_DAMAGE_PER_VEHICLE, which
// it equals only by coincidence — the same reasoning AMBUSH_DISTANCE_M records
// below against the hero power. Materials, so it converts through
// BASE_DAMAGE_DIVISOR: 40k is 40 HP of a default 1000.
export const VENGEFUL_BASE_DAMAGE = 40_000

// Ambush: "position your ships 600m closer to the enemy". Its own constant
// rather than a reuse of the hero power's: the two are equal by coincidence,
// and Ambush deliberately does NOT spend distanceModifiedBy (spec §7.3).
export const AMBUSH_DISTANCE_M = 600
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

// Factions a deck may use as its base (spec §3.1). TG joined in wave 7.
//
// ⚠ This is the DECK BUILDER's list, not a validation gate. `validateDeck`
// (engine/deckValidation.ts) never reads it — it compares a card's faction
// against the deck's own. The only functional reader in the repo is
// frontend/src/pages/DecksPage.tsx, which maps it into the faction <select>,
// so a faction missing here is seeded, visible in the catalog, and simply
// unreachable in the builder. Nothing in the engine suite can see that; the
// live deck-builder pass is the check.
//
// ⚠ AND THERE IS A THIRD COPY, IN THE DATABASE. `public.decks` carries a
// `decks_faction_check` CHECK constraint listing the same factions, which no
// code search finds because it is not code. Wave 7 seeded TG, confirmed it in
// the builder's dropdown, and still got a 23514 on the first real deck insert —
// the faction was undraftable in production with every test green.
// ADDING A FACTION HERE MEANS A MIGRATION TOO; see
// supabase/migrations/20260831222322_add_tg_to_decks_faction_check.sql.
// (`cards_faction_check` is fine — it lists every FACTIONS value, not just the
// draftable ones, which is why the 26 cards seeded cleanly.)
export const DECK_FACTIONS = ['DWG', 'GT', 'LH', 'OW', 'SS', 'TG', 'WF'] as const

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
  // Wave 7 (TG): "at turn start, reduce your resources this turn by 15% of
  // this card's cost". Ten TG cards carry it.
  UPKEEP_REQUIRED: 'upkeepRequired',
} as const

// UPKEEP_REQUIRED's rate. Charged in endTurn against the income that was just
// SET for the incoming side, off effectiveMaterialCostOf — never
// effectiveCostInGame, which is play-time-only and must not reach a recurring
// charge (spec §7.3, ruling U-1).
//
// The rate needs no per-card tuning because it is scale-invariant (U-8):
// income is set to floor(turnNumber) × materialsPerTurn rather than
// accumulated, so a card is unplayable until income reaches its cost, and its
// upkeep is therefore always ~15% of the income available on the turn it first
// becomes playable — at any cost and at any lobby rate. Mania (270k) lands at
// turn 4 and pays 13.5% of 300k; Fear (500k) lands at turn 7 and pays 14.3% of
// 525k.
export const UPKEEP_RATE = 0.15

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

// Max vehicles one player may have on their own side of ONE zone. Per zone
// SIDE, not per board and not per zone: your eight and the enemy's eight are
// independent, and a full zone 1 says nothing about zone 2.
//
// Enforced on the two routes a player CHOOSES to fill a zone with — playing
// (legalZonesFor) and moving (moveEntry). Spawns, revives and Boarding Party's
// swap deliberately bypass it, the same latitude spec §7.4 already gives them
// against every other placement rule ("spawning is not playing"); the swap is
// net-zero per side anyway.
//
// A play whose additionalSpawns would overshoot lands what FITS rather than
// being refused, so one free slot is the whole condition for playability.
// That is what keeps legalZonesFor from re-deriving the surge count, which it
// could not read correctly anyway: the count depends on materials as they
// stood BEFORE payment (see PLAY_CARD_TO_ZONE's ordering comment).
export const MAX_VEHICLES_PER_ZONE_SIDE = 8
export const DOUBLE_UP_MAX_COST = 400_000
// All for the Cause: "If the vehicle costed more than 250k, summon two
// instead." Printed materialCost, strictly greater — the same authority every
// other pool and threshold filter reads.
export const ALL_FOR_THE_CAUSE_DOUBLE_COST = 250_000
export const RESERVES_CARD_COUNT = 3
export const CHANGE_ORDER_DELAY_TURNS = 2

export const RHEA_MAX_PLANE_COST = 300_000 // Rhea: "base cost under 300k" (exclusive)
export const GT_HEAVY_AIRSHIP_MIN_COST = 400_000 // spec §7.3: the GT airship cost cliff

// Judgement: "while your opponent has a submarine or airship, this card costs
// 100k less". A flat discount, not a per-hull one — the text says "a", and one
// enemy sub is as much a reason as three. Read across the WHOLE enemy board:
// the card's own second sentence says "in this zone" and this one does not
// (spec §7.3, wave 6).
export const JUDGEMENT_DISCOUNT = 100_000

// Purifier: "a zone in which you have lost a fleet battle the previous turn".
// Turn numbers advance in HALF steps, so this window (1.0) is one full round —
// the actor's own previous turn plus the opponent's half-turn between, current
// turn included. Reading it as the strictly-previous half-step would admit only
// a defensive loss, which the card does not say (spec §7.3, wave 6).
export const PURIFIER_LOSS_WINDOW_TURNS = 1

export const EXCALIBUR_COST_DELTA = -200_000 // Excalibur: AI ship in hand costs 200k less
// Plunderer clause 2: "…draw one card from the enemy deck, but increase its
// cost by 20k". A POSITIVE costDelta, unlike every other one in this file —
// effectiveCostInGame sums it in and clamps only at zero, so it raises the
// play price and touches nothing else (2026-09-02 spec §6.1).
export const PLUNDERER_CAPTURE_SURCHARGE = 20_000
export const REPAIRMEN_READY_DRAW_MAX_COST = 400_000 // Repairmen Ready draws below this

export const FLYING_SQUIRREL_ATTACK_COUNT = 3 // Flying Squirrel Attack: target fights this many summons
export const MARTYR_ATTACK_COUNT = 4          // Martyr Attack: base summon count
export const MARTYR_ATTACK_BOOSTED_COUNT = 6  // Martyr Attack: target is an airship, or a 400k+ player design
export const MARTYR_ATTACK_BOOST_MIN_COST = 400_000
export const AIR_STRAFE_PREDATOR_COUNT = 2    // Air Strafe: PredatorX summons (always); +1 chosen hull vs a player design

// Catshark: "gain 30k resources this turn". No rider expires it — endTurn sets
// the incoming side's materials to floor(turnNumber) * MATERIALS_PER_TURN
// outright, so the grant lasts exactly until that side's next turn begins.
export const CATSHARK_MATERIALS = 30_000

// Sacrilego clause 2: "increase the remaining hp percent of a friendly ship by
// 15". The rescue band is SURVIVE_HP_PERCENT minus this — derive it, never
// write the number.
export const SACRILEGO_HP_BOOST = 15

// DWG Waters clause 2: "one DWG vehicle with a cost <60k from the game".
// Exclusive, on printed materialCost — the same authority every other pool
// filter reads.
export const DWG_WATERS_GUEST_MAX_COST = 60_000

// Harbringer: "you may spawn in one WF ship that costs <=100k to join the
// battle". INCLUSIVE, unlike DWG Waters' exclusive <60k — the two cards print
// different comparators and each keeps its own. Printed materialCost, WF
// ships only: The Repentance is a WF PLANE at exactly 100k, so the type
// filter is what excludes it rather than the cost.
export const HARBRINGER_GUEST_MAX_COST = 100_000

// Slasher: "add two earth rakers to your hand". Its own constant rather than a
// bare literal, matching MARTYR_ATTACK_COUNT and RESERVES_CARD_COUNT — the
// card text is then the only other place the number appears.
export const SLASHER_EARTH_RAKER_COUNT = 2

// Excruciator: "draw two AI vehicles from your deck and reduce their cost by
// 100k". A costDelta, so the sign lives with the number here rather than at the
// call site — the same convention EXCALIBUR_COST_DELTA follows.
export const EXCRUCIATOR_DRAW_COUNT = 2
export const EXCRUCIATOR_COST_DELTA = -100_000

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
