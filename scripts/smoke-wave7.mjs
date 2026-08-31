#!/usr/bin/env node
// Live smoke test for wave 7 — the TG faction — against the REAL deployed
// backend. Plumbing lives in ./smoke-lib.mjs; this file is scenarios only.
//
// What it proves that no unit test can:
//
//   * THE CATALOG PROBE for four new names — fearOnPlay, obeliskBattle,
//     havocFactoryEffect and mirthFactoryEffect all carry
//     { needsCatalog: true }. makeCtx hands every unit test a catalog, so a
//     missing flag is invisible until production, where it is a card that
//     silently does nothing.
//   * THE FACTORY ESCORT'S PROBE PATH specifically. Its trigger is a RUNTIME
//     stamp on a hull whose Factory card was spent turns earlier, so nothing
//     in play names the effect under a trigger key. It only works because the
//     probe scans every meta VALUE regardless of key, and the stamp's value is
//     the effect's own registry name. Nothing local can test that.
//   * UPKEEP THROUGH JSONB AND THROUGH A REAL TURN — ten cards carry a keyword
//     that did not exist in the repo a day ago, and the deduction happens in
//     endTurn against income that Postgres round-trips.
//   * THE LH POOL DID NOT WIDEN — the regression this wave could have shipped
//     with an empty diff. Asserted against the LIVE cards table.
//   * A CROSS-ZONE BATTLE THROUGH POSTGRES — an ActiveBattle whose defender is
//     not in its own zoneId is a shape production has never stored.
//   * DP8 END TO END — a resolve-phase trigger on a hull that was not in the
//     battle and is not even in its zone.
//
// ⚠ A live test whose result depends on the shuffle is not a test yet — wave 6
// lost two of three harness bugs to exactly that. Every card a scenario needs
// is `required` rather than hoped for, and the two games below pick their
// income deliberately rather than taking the default.
//
// Usage:  node scripts/smoke-wave7.mjs [--keep]
//   --keep   leave the games and lobbies behind for browser inspection
//
// Credentials come from scripts/qa-accounts.local (gitignored).

import {
  step, rest, signIn, builtIns, startGame, report, cleanUp, keep,
} from './smoke-lib.mjs'

console.log('\n  Wave 7 live smoke test — the TG faction\n')

const p1 = await signIn('P1')
const p2 = await signIn('P2')
step('signed in both QA accounts', true, `${p1.email} / ${p2.email}`)

const cards = await builtIns(p1.token)
step('fetched the built-in catalog', cards.length > 150, `${cards.length} cards`)

// ===================== the seed, before anything is played ==================
//
// Half this wave's behaviour lives in the cards table, so check it FIRST: a
// failure here explains every later failure at once. Wave 6 found five cards
// inert in production for exactly this reason — the merge deployed the code
// and nobody applied the seed.
{
  const tg = cards.filter((c) => c.faction === 'TG')
  const fresh = tg.filter((c) => !c.name.startsWith('[TG] '))
  step('the LIVE table holds all 26 new TG cards', fresh.length === 26, `${fresh.length} of 26`)
  step('TG is 30 rows in total, with the four borrowed ones', tg.length === 30, `${tg.length} rows`)

  // ⚠ THE REGRESSION THIS WAVE COULD HAVE SHIPPED WITH AN EMPTY DIFF. The LH
  // "[TG] Robotics" pool is the query `is_built_in AND faction = 'TG'`, so
  // seeding TG would have taken it from 4 rows to 30 with no line of
  // lhEffects.ts changing. This is the assertion that would say so.
  const pool = cards.filter((c) => c.meta?.lhRoboticsPool === true)
  step('the LH [TG] Robotics pool is still exactly four',
    pool.length === 4,
    pool.map((c) => c.name).sort().join(', ') || 'EMPTY — the marker did not seed')

  // The ten upkeep cards. If KEYWORDS.UPKEEP_REQUIRED ever resolves to
  // undefined again, these arrive as `[null, "robotic"]` and this is what says
  // so — the failure that has no error, no log line and no failing guard.
  const upkeep = cards.filter((c) => (c.keywords ?? []).includes('upkeepRequired'))
  step('exactly ten cards carry UPKEEP_REQUIRED', upkeep.length === 10,
    upkeep.map((c) => c.name).sort().join(', '))
  const nulls = cards.filter((c) => (c.keywords ?? []).some((k) => k === null))
  step('no card seeded a null keyword', nulls.length === 0,
    nulls.map((c) => c.name).join(', ') || 'clean')

  const byName = new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
  const want = {
    'TG:Curiosity': (m) => m?.additionalSpawns === 1,
    'TG:Acceptance': (m) => m?.resourceSurge?.materialsAtLeast === 150000 &&
      m?.resourceSurge?.extraSpawns === 1,
    'TG:Alarmed': (m) => m?.deployRequiresAiVehicle === true && m?.onPlayEffect === 'alarmedOnPlay',
    'TG:Fear': (m) => m?.onPlayEffect === 'fearOnPlay',
    'TG:Hysteria': (m) => m?.onPlayEffect === 'hysteriaOnPlay',
    'TG:Horror': (m) => m?.onBattleEffect === 'horrorBattle',
    'TG:Nostalgia': (m) => m?.onDeathEffect === 'nostalgiaOnDeath',
    'TG:Vengeful': (m) => m?.onBattleEffect === 'vengefulBattle',
    'TG:Obelisk': (m) => m?.onBattleEffect === 'obeliskBattle',
    'TG:Jealousy': (m) => m?.onDeathEffect === 'jealousyOnDeath',
    'TG:Duel': (m) => m?.onPlayEffect === 'duelEffect',
    'TG:Havoc Factory': (m) => m?.playOnVehicleEffect === 'havocFactoryEffect',
    'TG:Mirth Factory': (m) => m?.playOnVehicleEffect === 'mirthFactoryEffect',
    'TG:Havoc Swarm': (m) => m?.summonOnly === true,
    'TG:Mirth Swarm': (m) => m?.summonOnly === true,
  }
  const bad = Object.entries(want)
    .filter(([k, ok]) => !ok(byName.get(k)?.meta))
    .map(([k]) => k)
  step('the LIVE cards table carries wave 7 seeded meta', bad.length === 0,
    bad.length ? `missing/incorrect: ${bad.join(', ')}` : `${Object.keys(want).length} cards checked`)

  // Correction 1 had to land before the first seed: transform.ts derives each
  // uuid from `card:TG:<name>`, so a rename afterwards mints a NEW row and
  // leaves the old one behind. If both exist, the rename happened too late.
  step('Ecstasy seeded, and no stale "Extasy" row survives',
    !!byName.get('TG:Ecstasy') && !byName.get('TG:Extasy'),
    byName.get('TG:Extasy') ? 'BOTH rows exist — the rename landed after a seed' : 'clean')
  step('Havoc Swarm carries the corrected 120k cost',
    byName.get('TG:Havoc Swarm')?.material_cost === 120000,
    `${byName.get('TG:Havoc Swarm')?.material_cost}`)
}

const games = []

// ============ GAME A: TG (host) vs DWG (guest) — upkeep, spawns, copies =====
//
// 300k/turn. Fear is 800k, which at the 75k default is turn 11 and every turn
// is a round trip; nothing in this game keys off a materials threshold, so
// raising the income changes no behaviour under test. Game B uses a
// deliberately LOW rate for the one card that does.
{
  const g = await startGame(p1, p2, {
    label: 'wave7-smoke-a',
    materialsPerTurn: 300_000,
    p1Faction: 'TG', p1Required: ['Fear', 'Horror', 'Obelisk', 'Jealousy'],
    p2Faction: 'DWG', p2Required: ['Buccaneer'],
  }, cards)
  games.push(g)
  console.log('\n  -- game A: TG (host) vs DWG (guest), 300k/turn\n')

  const aSide = await g.sideOf(p1)

  // ---- Fear: the catalog probe, and three Horrors ------------------------
  {
    const fear = await g.drawUntil(p1, 'Fear')
    await g.waitForMaterials(p1, (m) => m >= 800_000)
    const res = await g.attempt(p1, {
      type: 'PLAY_CARD_TO_ZONE', instanceId: fear.instanceId, zoneId: 1,
    })
    step('Fear deployed', res.status === 200, `HTTP ${res.status}`)
    const state = (await g.load(p1)).state
    const horrors = state.zones.map((z) => z.cards[aSide].filter((c) => c.name === 'Horror').length)
    step('catalog probe: Fear spawned one Horror into EVERY zone',
      horrors.every((n) => n === 1), `per zone: ${horrors.join(', ')}`)
    // Spawning skips onPlayEffect and NOTHING else, so each Horror keeps its
    // own copy trigger. This is what makes Fear name Horror rather than a
    // vanilla hull.
    const one = state.zones[1].cards[aSide].find((c) => c.name === 'Horror')
    step('each spawned Horror kept its printed onBattleEffect',
      one?.meta?.onBattleEffect === 'horrorBattle', JSON.stringify(one?.meta ?? {}))
    // A Horror is a SHIP, and zone 3 is normally land — spawns bypass
    // placement legality (spec §7.4), which only a real board shows.
    step('a Horror reached a zone a ship could not be PLAYED into',
      horrors[2] === 1, `zone 3 biome ${state.zones[2].biome}`)
  }

  // ---- upkeep: the keyword that did not exist a day ago -------------------
  {
    // Fear (120k) + three Horrors (10.5k each) = 151,500 a turn.
    const before = (await g.load(p1)).state.resources[aSide].materials
    await g.passTo(p2)
    await g.passTo(p1)
    const after = (await g.load(p1)).state
    const income = Math.floor(after.turnNumber) * 300_000
    step('upkeep was charged at the turn start',
      after.resources[aSide].materials === income - 151_500,
      `income ${income}, held ${after.resources[aSide].materials}, expected ${income - 151_500}`)
    step('one upkeep log line, carrying the total',
      after.log.filter((l) => l.toLowerCase().includes('upkeep')).length === 1,
      after.log.filter((l) => l.toLowerCase().includes('upkeep')).join(' | '))
    void before
  }
}

// =========== GAME B: TG (host) vs DWG (guest) — battles and DP8 =============
{
  const g = await startGame(p1, p2, {
    label: 'wave7-smoke-b',
    materialsPerTurn: 300_000,
    p1Faction: 'TG', p1Required: ['Obelisk', 'Vengeful', 'Havoc Factory', 'Duel'],
    p2Faction: 'DWG', p2Required: ['Buccaneer'],
  }, cards)
  games.push(g)
  console.log('\n  -- game B: TG (host) vs DWG (guest) — battles\n')

  const aSide = await g.sideOf(p1)
  const bSide = await g.sideOf(p2)

  // ---- Obelisk's battle summon -------------------------------------------
  //
  // ⚠ Obelisk is STEALTHY, so an ATTACK_ENEMY_FLEET naming it raises the
  // response window instead of locking — and DP2's WHOLE dispatch then happens
  // on RESPOND_TO_ATTACK. g.lockIfPending is the harness helper that already
  // knows this; a fresh scenario would have had to relearn it.
  {
    const obelisk = await g.drawUntil(p1, 'Obelisk')
    await g.attempt(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: obelisk.instanceId, zoneId: 1 })
    await g.passTo(p2)
    await g.deployShip(p2, 1)
    await g.passTo(p1)
    const attack = await g.attempt(p1, {
      type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
      attackerIds: [obelisk.instanceId],
      targetIds: (await g.load(p1)).state.zones[0].cards[bSide].map((c) => c.instanceId),
    })
    step('fleet attack declared with Obelisk', attack.status === 200, `HTTP ${attack.status}`)
    await g.lockIfPending(p2)
    const battle = (await g.load(p1)).state.activeBattle
    step('catalog probe: Obelisk summoned a Mirth Swarm into the battle',
      battle?.summons?.some((s) => s.name === 'Mirth Swarm'),
      `summons: ${(battle?.summons ?? []).map((s) => s.name).join(', ') || 'none'}`)
    step('the Swarm joined Obelisk’s own side',
      battle?.attackerIds?.includes(battle?.summons?.[0]?.instanceId),
      `attackers ${battle?.attackerIds?.length}, defenders ${battle?.defenderIds?.length}`)
    // A summon never reaches zone.cards — that is what makes it evaporate.
    const onBoard = (await g.load(p1)).state.zones[0].cards[aSide].map((c) => c.name)
    step('the Swarm is not on the board', !onBoard.includes('Mirth Swarm'), onBoard.join(', '))
  }
}

await report(games, p1)
if (!keep) await cleanUp(games, p1)
void rest
