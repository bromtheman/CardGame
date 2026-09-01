// Wave 7's mutation set — the TG faction.
//
// Run:  node scripts/mutations-wave7.mjs
//
// Every entry flips ONE decision wave 7 made, and names the ruling or the
// failure mode it is checking. A SURVIVOR is a finding: some test claimed to
// cover that line and did not.
//
// TWO entries are labelled UNREACHABLE and are EXPECTED to survive. Both are
// defence-in-depth side checks that no dispatch can currently violate, and
// both were confirmed unreachable by reading the callers rather than by
// assuming it — see the comments at each site. They are kept in the set so a
// future change that makes them reachable shows up as a newly-killable
// mutation rather than as silence.
//
// ⚠ Before trusting a green run, prove the harness can fail for the RIGHT
// reason. Wave 6 scored a perfect 62/62 that was entirely false — every
// mutation was being killed by a drift test that fails for any shared/ edit,
// hiding 16 real gaps. Wave 7's proof: mutating Math.ceil -> Math.floor in
// costs.ts was killed by exactly one named test, "U-2: rounds up, matching
// repairCostOf", and by nothing else.

import { runMutations } from './mutation-harness.mjs'

runMutations([
  // ---------------------------------------------------------------- upkeep
  ['shared/engine/costs.ts',
    'Math.ceil(effectiveMaterialCostOf(entry) * UPKEEP_RATE)',
    'Math.floor(effectiveMaterialCostOf(entry) * UPKEEP_RATE)',
    'U-2: upkeep rounds down instead of up'],
  ['shared/engine/costs.ts',
    'owed += Math.ceil(effectiveMaterialCostOf(entry) * UPKEEP_RATE)',
    'owed += Math.ceil(entry.materialCost * UPKEEP_RATE)',
    'U-1: upkeep reads printed cost instead of effectiveMaterialCostOf'],
  ['shared/engine/costs.ts',
    "if (!entry.keywords.includes(KEYWORDS.UPKEEP_REQUIRED)) continue",
    'if (false) continue',
    'U-4: every hull pays upkeep, keyword or not'],
  ['shared/engine/gameEngine.ts',
    'Math.max(0, game.state.resources[side].materials - upkeep)',
    'game.state.resources[side].materials - upkeep',
    'U-3: upkeep is not clamped at zero'],

  // ------------------------------------------------------------- LH pool
  ['shared/effects/primitives.ts',
    'if (f.metaFlag !== undefined && card.meta[f.metaFlag] !== true) return false',
    'if (f.metaFlag !== undefined && card.meta[f.metaFlag] === undefined) return false',
    'L-1: the pool marker is checked for presence, not value'],

  // -------------------------------------------------------------- Alarmed
  ['shared/engine/placement.ts',
    'return !zone?.cards[side].some((c) => c.isBuiltIn)',
    'return !zone?.cards[side].some((c) => !c.isBuiltIn)',
    'D-1: "AI vehicle" inverted to mean a player design'],
  ['shared/engine/placement.ts',
    'if (card.meta.deployRequiresAiVehicle !== true) return false',
    'if (card.meta.deployRequiresAiVehicle !== true) return true',
    'D-1: the prerequisite blocks every card instead of only Alarmed'],
  ['shared/effects/tgEffects.ts',
    '(e) => e.isBuiltIn && !placed.has(e.instanceId),',
    '(e) => e.isBuiltIn,',
    'Alarmed can offer itself as its own sacrifice'],

  // --------------------------------------------------------------- Horror
  ['shared/effects/tgEffects.ts',
    "if (!battle || battle.phase !== 'resolve' || !battle.survived) return true",
    "if (!battle || battle.phase !== 'resolve') return true",
    'D-3: Horror copies itself even when it died'],
  ['shared/effects/tgEffects.ts',
    '(c) => c.name === card.name && (c as ZoneCardEntry).playedOnTurn === game.turnNumber,',
    '(c) => c.name === card.name && (c as ZoneCardEntry).playedOnTurn !== game.turnNumber,',
    'D-4: the per-zone-per-turn cap is inverted'],

  // ------------------------------------------------------------ Nostalgia
  ['shared/engine/battleTriggers.ts',
    'const meta = owner !== side ? { ...snapshot.meta, ownerSide: owner } : snapshot.meta',
    'const meta = snapshot.meta',
    'a captured Nostalgia returns without its loan marker (a silent theft)'],

  // ------------------------------------------------------- Vengeful / DP8
  ['shared/effects/tgEffects.ts',
    'const lost = battle.casualties.filter((c) => c.side === actor).length',
    'const lost = battle.casualties.length',
    'E-2: Vengeful counts the ENEMY’s losses too'],
  ['shared/effects/tgEffects.ts',
    'if (!found || found.side !== actor) return true // E-2b',
    'if (!found) return true // E-2b',
    'E-2b: Vengeful drops its side re-check (UNREACHABLE — see note)'],
  ['shared/engine/battleTriggers.ts',
    'if (name !== null && RESOLVE_BYSTANDER_EFFECTS.has(name)) bystanders.push({ entry, side })',
    'if (name !== null) bystanders.push({ entry, side })',
    'DP8 broadcasts to every battle trigger instead of its members'],

  // ------------------------------------------------------------ Factories
  ['shared/engine/gameEngine.ts',
    'const { costDelta: _costDelta, factoryEscort: _factoryEscort, ...withoutCostDelta } = snapshot.meta',
    'const { costDelta: _costDelta, ...withoutCostDelta } = snapshot.meta',
    'the Factory stamp rides into the discard and back into the deck'],
  ['shared/effects/tgEffects.ts',
    'if (!found.entry.keywords.includes(KEYWORDS.ROBOTIC)) return false',
    'if (false) return false',
    'E-5: a Factory accepts a non-ROBOTIC target'],
  ['shared/effects/tgEffects.ts',
    'if (!found || found.side !== actor) return false\n    if (!found.entry.keywords.includes(KEYWORDS.ROBOTIC)) return false',
    'if (!found) return false\n    if (!found.entry.keywords.includes(KEYWORDS.ROBOTIC)) return false',
    'E-5: a Factory can be played onto an ENEMY hull'],

  // ----------------------------------------------------------------- Duel
  ['shared/engine/battleDeclare.ts',
    '? findVehicle(game.state, id)?.side === side',
    '? findVehicle(game.state, id) !== null',
    'a cross-zone battle accepts a hull on the WRONG side'],
  ['shared/engine/battleDeclare.ts',
    "spec.crossZone\n      ? findVehicle(game.state, id)?.side === side\n      : zone.cards[side].some((c) => c.instanceId === id)",
    'findVehicle(game.state, id)?.side === side',
    'crossZone stops being opt-in — every forced battle goes board-wide'],
  ['shared/engine/battleResolve.ts',
    'const home = findVehicle(game.state, id)?.zone ?? zone',
    'const home = zone',
    'a destroyed away hull stays on the board'],
  ['shared/engine/battleResolve.ts',
    'participantZones[side].add(findVehicle(game.state, id)?.zone.id ?? battle.zoneId)',
    'participantZones[side].add(battle.zoneId)',
    'E-9: the loss is recorded in the battle’s zone, not the loser’s'],
  ['shared/effects/tgEffects.ts',
    '(e) => !e.keywords.includes(KEYWORDS.INOFFENSIVE),',
    '() => true,',
    'E-10: Duel offers an Inoffensive hull as its attacker'],
  ['shared/effects/tgEffects.ts',
    'if (mine.entry.keywords.includes(KEYWORDS.INOFFENSIVE)) return false',
    'if (false) return false',
    'E-10: the resolve-time Inoffensive re-check is gone'],

  // ------------------------------------------------------- Fear / Obelisk
  ['shared/effects/tgEffects.ts',
    "zones: 'all',",
    "zones: 'target',",
    'Fear spawns one Horror instead of one per zone'],
  ['shared/effects/tgEffects.ts',
    "if (!battle || battle.phase !== 'lock' || !battle.isParticipant) return true",
    'if (!battle || !battle.isParticipant) return true',
    'Obelisk summons again at resolve, into a battle that is over'],

  // -------------------------------------------------------------- Hysteria
  ['shared/effects/tgEffects.ts',
    'if (!found || found.side !== otherSide(actor)) return false',
    'if (!found) return false',
    'Hysteria drops its resolve-time enemy-side re-check (UNREACHABLE — see note)'],
])
