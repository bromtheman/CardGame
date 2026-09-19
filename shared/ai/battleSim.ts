import { KEYWORDS, SURVIVE_HP_PERCENT, VEHICLE_TYPES } from '../gameSettings.ts'
import type { EngineGame, ZoneCardEntry } from '../engine/engineTypes.ts'
import { battleParticipants, effectiveMaterialCostOf } from '../engine/index.ts'
import { shipProfileOf } from '../shipProfiles.ts'

// A strength-based stand-in for the fleet battle the human fights in From
// The Depths — for the eval harness and the self-play net only, never a
// function. It replaces the old coin flip (uniform HP per hull), under which
// "declare battles you expect to win" was unlearnable: the eval could not
// reward a good fight or punish a bad one.
//
// Strength is the game's own currency, effective material cost, shaded by
// the FtDArmament profiles where a hull has one: firepower and the matchup
// against what the enemy fields scale offense, toughness scales defense, a
// score of three is neutral, and an unprofiled hull (OW, TG, summons,
// customs) fights as plain cost. Inoffensive hulls cannot attack (they still
// defend). Each side's expected loss follows how outgunned it is, a seeded
// noise factor lets a fight go against the odds, and each hull's fate is
// bimodal like a real battle: focused (dead or repairable) or untouched.
// Fragile, Scrappy, a flanked side and the repairs stay the engine's business
// — this only writes the report's HP figures. Distance, who attacked, and
// the missiles matchup are ignored on purpose.

export interface HullStrength { offense: number; defense: number }

// 0.85 + 0.05 × score: a 1 is 0.9, a 3 is 1.0, a 5 is 1.1 — profiles tip a
// fight, cost decides it. Calibrated 2026-09-19: at 0.7 + 0.1 × score WF lost
// about nine eval games in ten whoever held it (its small hulls sit in the
// bottom quintiles), while under random battles it held parity — and WF is
// not weak in From The Depths; its strength is big hulls and tactics no
// resolver sees. A 1.5× price now beats the best profile in the set.
const shade = (score: number): number => 0.85 + 0.05 * score
const NEUTRAL = 3

type MatchupKey = 'ships' | 'aircraft' | 'submarines'
function matchupKeyOf(vehicleType: string | null): MatchupKey {
  if (vehicleType === VEHICLE_TYPES.PLANE || vehicleType === VEHICLE_TYPES.AIRSHIP) return 'aircraft'
  if (vehicleType === VEHICLE_TYPES.SUB) return 'submarines'
  return 'ships'   // ships and tanks: the reports rate surface fights as "ships"
}

export function hullStrength(entry: ZoneCardEntry, enemies: readonly ZoneCardEntry[]): HullStrength {
  const cost = effectiveMaterialCostOf(entry)
  const profile = shipProfileOf(entry.faction, entry.name)
  const firepower = profile?.scores.firepower.score ?? NEUTRAL
  const toughness = profile?.scores.toughness.score ?? NEUTRAL
  // The matchup against the enemy's mix: the mean of this hull's score
  // against each enemy hull's kind, so a picket facing three planes and a
  // ship is judged mostly on its anti-air.
  const matchup = enemies.length === 0 || profile === null
    ? NEUTRAL
    : enemies.reduce((sum, e) => sum + profile.matchups[matchupKeyOf(e.vehicleType)].score, 0) / enemies.length
  const inoffensive = entry.keywords.includes(KEYWORDS.INOFFENSIVE)
  return {
    offense: inoffensive ? 0 : cost * shade(firepower) * shade(matchup),
    defense: cost * shade(toughness),
  }
}

// The share of a side's hulls expected to be focused: a Lanchester-like
// SQUARE law, ratio² / (1 + ratio²) of enemy offense to own defense — a half
// in an even fight, nine tenths when outgunned three to one (not three
// quarters, as the earlier linear ratio/(1+ratio) law gave).
//
// 2026-09-19 scored-menu Task 3 fix round 1: the linear law lost
// M·E/(M+E) of value on BOTH sides in expectation, for any mismatch M:E —
// declaring ANY fleet attack was zero-sum on tempo, because a side twice as
// dear was, in expectation, exactly twice as likely to come out ahead by
// exactly the amount that made the trade a wash either way. The square law
// breaks that: expected losses now favour the stronger side in ABSOLUTE
// cost, so declaring a battle you are stronger in gains tempo, and one
// you are outgunned in loses it, rather than merely trading it.
export function lossFraction(ownDefense: number, enemyOffense: number): number {
  if (enemyOffense <= 0) return 0
  if (ownDefense <= 0) return 1
  const ratio = enemyOffense / ownDefense
  const ratioSquared = ratio * ratio
  return ratioSquared / (1 + ratioSquared)
}

// One draw of a noise factor on the odds, ~lognormal with σ ≈ 0.3: three
// uniforms summed approximate a normal, and a fight three sigma against the
// odds is rare, not impossible.
const oddsNoise = (rng: () => number): number => Math.exp((rng() + rng() + rng() - 1.5) * 0.6)

// Tougher hulls are focused less often, by the same shade in inverse: 1.11
// at toughness 1, 1.0 at 3, 0.91 at 5.
const focusFactor = (toughness: number): number => 1 / shade(toughness)
const FOCUS_CAP = 0.95
// A focused hull's HP is drawn from below the survive line: most of that
// band is destruction, the top of it the repair window.
const FOCUSED_HP_MIN = 30
const UNTOUCHED_HP_MIN = SURVIVE_HP_PERCENT

// The report for game.state.activeBattle: instanceId → ending HP %, every
// participant included (battleParticipants covers the zone, the summons and
// an away hull), from the given rng and nothing else.
export function resolveBattle(game: EngineGame, rng: () => number): Record<string, number> {
  const participants = [...battleParticipants(game.state).values()]
  const sides = { a: participants.filter((p) => p.side === 'a').map((p) => p.entry), b: participants.filter((p) => p.side === 'b').map((p) => p.entry) }
  const strength = (side: 'a' | 'b') => {
    const enemies = sides[side === 'a' ? 'b' : 'a']
    return sides[side].map((entry) => ({ entry, ...hullStrength(entry, enemies) }))
  }
  const rated = { a: strength('a'), b: strength('b') }
  const offense = { a: rated.a.reduce((s, h) => s + h.offense, 0), b: rated.b.reduce((s, h) => s + h.offense, 0) }
  const defense = { a: rated.a.reduce((s, h) => s + h.defense, 0), b: rated.b.reduce((s, h) => s + h.defense, 0) }
  const noise = oddsNoise(rng)
  // One noise draw tilts the whole fight: what favours a is what hurts b.
  const loss = { a: lossFraction(defense.a, offense.b * noise), b: lossFraction(defense.b, offense.a / noise) }
  const results: Record<string, number> = {}
  for (const side of ['a', 'b'] as const) {
    for (const { entry } of rated[side]) {
      const toughness = shipProfileOf(entry.faction, entry.name)?.scores.toughness.score ?? NEUTRAL
      const focused = rng() < Math.min(FOCUS_CAP, loss[side] * focusFactor(toughness))
      const hp = focused
        ? FOCUSED_HP_MIN + rng() * (SURVIVE_HP_PERCENT - 1 - FOCUSED_HP_MIN)
        : UNTOUCHED_HP_MIN + rng() * (100 - UNTOUCHED_HP_MIN)
      results[entry.instanceId] = Math.round(hp)
    }
  }
  return results
}

