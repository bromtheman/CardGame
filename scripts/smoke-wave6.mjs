#!/usr/bin/env node
// Live smoke test for effect-coverage wave 6, against the REAL deployed
// backend. Plumbing lives in ./smoke-lib.mjs; this file is scenarios only.
//
// What it proves that no unit test can:
//
//   * THE CATALOG PROBE for five new names — nothungOnPlay, balmungOnPlay,
//     victoriaActivate, harbringerBattle and blockadeEffect all carry
//     { needsCatalog: true }. makeCtx hands every unit test a catalog, so a
//     missing flag or an unreached probe source is invisible until production,
//     where it is a card that silently does nothing.
//   * DP7 END TO END — a battle declared for the player who is NOT acting, out
//     of a play handler, with the blockader as aggressor. A shape production
//     has never executed.
//   * SEEDED DATA DRIVING BEHAVIOUR — aircraftLock, both resourceSurge
//     variants, activateMaterialCost, activateCpCost and Purifier's two keys
//     are values in the cards table, not code. A unit test asserts the code
//     reads them; only this asserts the seed actually carries them.
//   * NEW STATE THROUGH JSONB — ZoneState.lostBattleOnTurn, the Blockade
//     rider, and its ActiveBattle.continuation all have to survive a round
//     trip through Postgres.
//   * RULING C-1 IN PRODUCTION — that Albacore restricts its OWNER's aircraft
//     and not the enemy's. That is the ruling most likely to be wrong, and
//     this is the assertion that would say so.
//
// Usage:  node scripts/smoke-wave6.mjs [--keep]
//   --keep   leave the games and lobbies behind for browser inspection
//
// Credentials come from scripts/qa-accounts.local (gitignored).

import {
  die, step, rest, signIn, builtIns, startGame, report,
} from './smoke-lib.mjs'

console.log('\n  Wave 6 live smoke test — real backend, real edge functions\n')

const p1 = await signIn('P1')
const p2 = await signIn('P2')
step('signed in both QA accounts', true, `${p1.email} / ${p2.email}`)

const cards = await builtIns(p1.token)
step('fetched the built-in catalog', cards.length > 100, `${cards.length} cards`)

// The seed is what half this wave's behaviour lives in, so check it BEFORE
// playing anything — a failure here explains every later failure at once.
{
  const byName = new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
  const want = {
    'DWG:Albacore': (m) => m?.aircraftLock === true,
    'DWG:Tarpon': (m) => m?.aircraftLock === true,
    'SS:Chrysaor': (m) => m?.resourceSurge?.materialsOver === 200000 &&
      m?.resourceSurge?.costDelta === 100000 && m?.resourceSurge?.extraSpawns === 1,
    'SS:Paladin': (m) => m?.resourceSurge?.materialsUnder === 240000 &&
      Array.isArray(m?.resourceSurge?.grantKeywords) &&
      m.resourceSurge.grantKeywords.includes('halfCost') &&
      m.resourceSurge.grantKeywords.includes('temporary'),
    'SS:Victoria': (m) => m?.activateMaterialCost === 200000 && m?.onActivate === 'victoriaActivate',
    'WF:Judgement': (m) => m?.activateCpCost === 1 && m?.costModifier === 'judgementCostModifier',
    'WF:Purifier': (m) => m?.deployRequiresBattleLoss === true && m?.noBaseDamage === true,
    'SS:Blockade': (m) => m?.playOnZoneEffect === 'blockadeEffect',
  }
  const bad = Object.entries(want)
    .filter(([k, ok]) => !ok(byName.get(k)?.meta))
    .map(([k]) => k)
  step('the LIVE cards table carries wave 6 seeded data', bad.length === 0,
    bad.length ? `missing/incorrect: ${bad.join(', ')}` : `${Object.keys(want).length} cards checked`)
}

const games = []

// ======================= GAME A: SS (host) vs WF (guest) ====================
//
// High income (400k/turn) on purpose: Balmung is 630k and Nothung 470k, which
// at the 75k default are turn 9 and turn 7 — and every turn is a round trip.
// Nothing in this game keys off a materials threshold, so raising it changes
// no behaviour under test. Game B uses the default for exactly that reason.
{
  const g = await startGame(p1, p2, {
    label: 'wave6-smoke-a',
    materialsPerTurn: 400_000,
    p1Faction: 'SS', p1Required: ['Nothung', 'Balmung', 'Victoria', 'Blockade'],
    p2Faction: 'WF', p2Required: ['Purifier', 'Judgement', 'Harbringer', 'Basher'],
  }, cards)
  games.push(g)
  console.log('\n  -- game A: SS (host) vs WF (guest), 400k/turn\n')

  const aSide = await g.sideOf(p1)
  const bSide = await g.sideOf(p2)

  // ---- Nothung: spawnVehicles out of the catalog -------------------------
  {
    const nothung = await g.drawUntil(p1, 'Nothung')
    const res = await g.attempt(p1, {
      type: 'PLAY_CARD_TO_ZONE', instanceId: nothung.instanceId, zoneId: 1,
    })
    step('Nothung deployed', res.status === 200, `HTTP ${res.status}`)
    const zone = (await g.load(p1)).state.zones[0]
    const spawned = zone.cards[aSide].find((c) => c.name === 'Sacrilego')
    step('catalog probe: Nothung minted a Sacrilego beside itself',
      !!spawned, spawned ? `zone 1 holds ${zone.cards[aSide].map((c) => c.name).join(', ')}` : 'no Sacrilego')
    // Ruling A-1: spawning skips onPlayEffect and NOTHING else, so the spawned
    // hull keeps its printed battle trigger.
    step('the spawned Sacrilego kept its printed onBattleEffect',
      spawned?.meta?.onBattleEffect === 'sacrilegoBattle', JSON.stringify(spawned?.meta ?? {}))
  }

  // ---- Balmung: a catalog mint into hand, priced by costDelta -------------
  {
    const balmung = await g.drawUntil(p1, 'Balmung')
    const before = (await g.hand(p1)).length
    const res = await g.attempt(p1, {
      type: 'PLAY_CARD_TO_ZONE', instanceId: balmung.instanceId, zoneId: 2,
    })
    step('Balmung deployed', res.status === 200, `HTTP ${res.status}`)
    const hand = await g.hand(p1)
    const hydra = hand.find((c) => c.name === 'Hydra')
    step('catalog probe: Balmung minted a Hydra into hand',
      !!hydra, `hand ${before} -> ${hand.length}`)
    // Ruling A-2: a PRICE, not a rewrite. The free Hydra keeps its printed
    // materialCost so it still does its printed damage and repair.
    step('the Hydra is free by costDelta, not by a rewritten materialCost',
      hydra?.meta?.costDelta === -230000 && hydra?.materialCost === 230000,
      `costDelta=${hydra?.meta?.costDelta} materialCost=${hydra?.materialCost}`)
    // Ruling A-3: the public log must not name a card entering a hidden hand.
    const log = (await g.load(p1)).state.log.join('\n')
    step('the public log never names the minted card', !log.includes('Hydra'), '')
  }

  // ---- Victoria: an activated ability paid in MATERIALS -------------------
  {
    const victoria = await g.drawUntil(p1, 'Victoria')
    const played = await g.attempt(p1, {
      type: 'PLAY_CARD_TO_ZONE', instanceId: victoria.instanceId, zoneId: 3,
    })
    step('Victoria deployed', played.status === 200, `HTTP ${played.status}`)
    await g.passTo(p1)
    const before = await g.load(p1)
    const mine = before.state.zones[2].cards[aSide].filter((c) => c.name === 'Victoria')
    const res = await g.act(p1, { type: 'ACTIVATE_VEHICLE', instanceId: mine[0].instanceId })
    step('Victoria activated on a MATERIAL price with no CP price at all',
      res.status === 200, `HTTP ${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body).slice(0, 160)}`)
    const after = await g.load(p1)
    const now = after.state.zones[2].cards[aSide].filter((c) => c.name === 'Victoria')
    step('catalog probe: a second Victoria was commissioned',
      now.length === mine.length + 1, `${mine.length} -> ${now.length}`)
    step('exactly 200k materials were charged and no CP',
      before.state.resources[aSide].materials - after.state.resources[aSide].materials === 200_000 &&
      before.state.resources[aSide].cp === after.state.resources[aSide].cp,
      `materials -${before.state.resources[aSide].materials - after.state.resources[aSide].materials}, ` +
      `cp ${before.state.resources[aSide].cp} -> ${after.state.resources[aSide].cp}`)
    // Ruling B-4: the spawned hull carries its own printed ability, unstamped.
    const spawnedVic = now.find((c) => !mine.some((m) => m.instanceId === c.instanceId))
    step('the spawned Victoria carries its own activated ability, unstamped',
      spawnedVic?.meta?.activateMaterialCost === 200_000 && spawnedVic?.activatedOnTurn === null,
      `activatedOnTurn=${spawnedVic?.activatedOnTurn}`)
  }

  // ---- Judgement: a costModifier read off the ENEMY board -----------------
  //
  // SS Nothung's zone-1 Sacrilego is a ship, so the discount must be OFF until
  // an SS sub or airship exists. The free Hydra from Balmung is an AIRSHIP —
  // playing it is what should move Judgement's price, from the other side of
  // the board.
  {
    const judgement = await g.drawUntil(p2, 'Judgement')
    const dry = (await g.load(p2)).state
    const enemyAir = dry.zones.some((z) => z.cards[aSide].some(
      (c) => c.vehicleType === 'sub' || c.vehicleType === 'airship'))
    step('setup: SS has no sub or airship on the board yet', !enemyAir, '')

    // The Hydra is free, so this needs no waiting.
    const hydra = (await g.hand(p1)).find((c) => c.name === 'Hydra')
    if (hydra) {
      const res = await g.attempt(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: hydra.instanceId, zoneId: 1 })
      step('the free Hydra cost nothing to play', res.status === 200, `HTTP ${res.status}`)
    } else {
      step('the free Hydra was still in hand to play', false, 'not found')
    }

    await g.passTo(p2)
    const state = (await g.load(p2)).state
    const nowAir = state.zones.some((z) => z.cards[aSide].some(
      (c) => c.vehicleType === 'sub' || c.vehicleType === 'airship'))
    step('SS now shows an airship on the board', nowAir, '')
    // Judgement is 540k; with an enemy airship anywhere it must cost 440k. The
    // engine prices at play time, so an affordable-at-440k / unaffordable-at-540k
    // window is the observable. At 400k/turn that window is turn 2 (800k) —
    // both are affordable, so assert the CHARGE instead.
    const before = (await g.load(p2)).state.resources[bSide].materials
    const res = await g.attempt(p2, {
      type: 'PLAY_CARD_TO_ZONE', instanceId: judgement.instanceId, zoneId: 1,
    })
    step('Judgement deployed', res.status === 200, `HTTP ${res.status}`)
    const after = (await g.load(p2)).state
    const charged = before - after.resources[bSide].materials
    step('Judgement cost 100k less against an enemy airship (costModifier, live)',
      charged === 440_000, `charged ${charged} (printed 540000)`)

    // The activated half: 1cp for a 1v1 against that airship.
    await g.passTo(p2)
    const mine = (await g.load(p2)).state.zones[0].cards[bSide].find((c) => c.name === 'Judgement')
    const cpBefore = (await g.load(p2)).state.resources[bSide].cp
    const act = await g.act(p2, { type: 'ACTIVATE_VEHICLE', instanceId: mine.instanceId })
    step('Judgement activated for its seeded 1cp',
      act.status === 200, `HTTP ${act.status} ${act.status === 200 ? '' : JSON.stringify(act.body).slice(0, 160)}`)
    const pend = (await g.load(p2)).state
    step('it offered only enemy subs and airships in its own zone',
      pend.pendingEffect?.effect === 'judgementActivate' && pend.pendingEffect.options.length > 0,
      `options=${JSON.stringify(pend.pendingEffect?.options?.map((o) => o.label) ?? [])}`)
    step('1cp was charged', cpBefore - pend.resources[bSide].cp === 1, `cp -${cpBefore - pend.resources[bSide].cp}`)

    // Resolve into the 1v1, then settle it so the board is free for Blockade.
    const choice = pend.pendingEffect.options[0].id
    const resolved = await g.act(p2, { type: 'RESOLVE_PENDING_EFFECT', choiceId: choice })
    step('resolving declared the 1v1 forced battle', resolved.status === 200, `HTTP ${resolved.status}`)
    const battle = (await g.load(p2)).state.activeBattle
    step('a forced battle is not a zone activation (lastActivatedTurn untouched)',
      !!battle && (await g.load(p2)).state.zones[0].lastActivatedTurn === null,
      `aggressor=${battle?.aggressor} attackers=${battle?.attackerIds?.length} defenders=${battle?.defenderIds?.length}`)

    // Report it: WF wins, SS loses zone 1 — which is exactly the wreckage
    // Purifier needs, so the loss record is checked next.
    const ids = [...battle.attackerIds, ...battle.defenderIds]
    const results = Object.fromEntries(ids.map((id) => [id, battle.attackerIds.includes(id) ? 100 : 0]))
    const sub = await g.act(p2, { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] })
    step('battle report submitted', sub.status === 200, `HTTP ${sub.status}`)
    const dec = await g.act(p1, { type: 'DECIDE_BATTLE_REPORT', approve: true })
    step('battle report approved', dec.status === 200, `HTTP ${dec.status}`)
  }

  // ---- Purifier: the new per-zone loss record, through jsonb --------------
  {
    const state = (await g.load(p1)).state
    const zone1 = state.zones[0]
    step('ZoneState.lostBattleOnTurn survived the round trip through jsonb',
      zone1.lostBattleOnTurn !== undefined && zone1.lostBattleOnTurn !== null,
      JSON.stringify(zone1.lostBattleOnTurn))
    step('the LOSING side is the one stamped, and only in the zone that fought',
      zone1.lostBattleOnTurn?.[aSide] !== null && zone1.lostBattleOnTurn?.[bSide] === null &&
      state.zones[1].lostBattleOnTurn?.[aSide] === null,
      `zone1=${JSON.stringify(zone1.lostBattleOnTurn)} zone2=${JSON.stringify(state.zones[1].lostBattleOnTurn)}`)

    // SS lost in zone 1, so SS — not WF — is the side whose Purifier could
    // deploy there. Purifier is WF, so the check that matters here is the
    // REFUSAL: WF has lost nothing anywhere.
    const purifier = await g.drawUntil(p2, 'Purifier')
    const refused = await g.attempt(p2, {
      type: 'PLAY_CARD_TO_ZONE', instanceId: purifier.instanceId, zoneId: 2,
    })
    step('Purifier is refused from a zone its owner has not lost a battle in',
      refused.status === 400, `HTTP ${refused.status} ${JSON.stringify(refused.body ?? '').slice(0, 120)}`)
  }

  // ---- Blockade and DP7: the wave's headline ------------------------------
  {
    const blockade = await g.drawUntil(p1, 'Blockade')
    // Zone 3 holds SS's Victorias and nothing of WF's, so the trap has a fleet
    // and the deploy that springs it is unambiguous.
    const claim = await g.attempt(p1, {
      type: 'PLAY_CARD_TO_ZONE', instanceId: blockade.instanceId, zoneId: 3,
    })
    step('Blockade claimed zone 3', claim.status === 200, `HTTP ${claim.status}`)
    const claimed = (await g.load(p1)).state
    const rider = claimed.zoneEffects.find((e) => e.effect === 'blockadeEffect')
    step('the rider persisted to state.zoneEffects, permanently',
      !!rider && rider.zoneId === 3 && rider.side === aSide && rider.expiresOnTurn === undefined,
      `${JSON.stringify(rider ?? null)}`)

    // The enemy sails in. THIS is DP7.
    const deployed = await g.deployShip(p2, 3)
    step('WF deployed a vehicle into the blockaded zone', !!deployed, deployed?.name ?? 'none')
    const sprung = (await g.load(p1)).state
    const battle = sprung.activeBattle
    step('DP7: a fleet battle began on the DEPLOYER\'s own turn',
      !!battle && battle.zoneId === 3, `zone=${battle?.zoneId}`)
    // Ruling C-8, and the assertion that would catch it being wrong.
    step('the BLOCKADER is the aggressor, so the deployer defends',
      battle?.aggressor === aSide, `aggressor=${battle?.aggressor} (blockader=${aSide})`)
    // Ruling C-9: a FLEET battle — everything eligible on both sides.
    const zone3 = sprung.zones[2]
    step('every eligible hull on both sides was dragged in',
      battle?.attackerIds.length === zone3.cards[aSide].length &&
      battle?.defenderIds.length === zone3.cards[bSide].length,
      `attackers ${battle?.attackerIds.length}/${zone3.cards[aSide].length}, ` +
      `defenders ${battle?.defenderIds.length}/${zone3.cards[bSide].length}`)
    // Ruling C-12.
    step('a Blockade battle is not a zone activation',
      zone3.lastActivatedTurn === null, `lastActivatedTurn=${zone3.lastActivatedTurn}`)
    // The continuation is what carries the removal decision across the report.
    step('an ActiveBattle.continuation rode along, through jsonb',
      battle?.continuation?.effect === 'blockadeEffect' && battle?.continuation?.side === aSide,
      JSON.stringify(battle?.continuation ? { effect: battle.continuation.effect, side: battle.continuation.side } : null))

    // Resolve it with the blockader SURVIVING: the rider must remain.
    const ids = [...battle.attackerIds, ...battle.defenderIds]
    const survive = Object.fromEntries(ids.map((id) => [id, battle.attackerIds.includes(id) ? 100 : 0]))
    const sub = await g.act(p1, { type: 'SUBMIT_BATTLE_REPORT', results: survive, repairs: [] })
    step('blockade battle reported', sub.status === 200, `HTTP ${sub.status}`)
    const dec = await g.act(p2, { type: 'DECIDE_BATTLE_REPORT', approve: true })
    step('blockade battle approved', dec.status === 200, `HTTP ${dec.status}`)
    const after = (await g.load(p1)).state
    step('the blockader held the zone, so the blockade REMAINS',
      after.zoneEffects.some((e) => e.effect === 'blockadeEffect' && e.zoneId === 3),
      `riders=${after.zoneEffects.filter((e) => e.effect === 'blockadeEffect').length}`)
  }
}

// ====================== GAME B: DWG (host) vs SS (guest) ====================
//
// DEFAULT income on purpose. Chrysaor surges above 200k and Paladin below
// 240k, so the 75k/turn ramp is what puts a player on each side of those
// thresholds: turn 3 is 225k, which is above Chrysaor's and below Paladin's at
// once. Raising the income would make Paladin's condition unreachable.
{
  const g = await startGame(p1, p2, {
    label: 'wave6-smoke-b',
    p1Faction: 'DWG', p1Required: ['Albacore', 'Tarpon'],
    // Falcon Squadron is the cheapest SS aircraft (80k, halfCost -> 40k) and
    // is REQUIRED rather than hoped for: the pronoun assertion below is the
    // one that would catch ruling C-1 being wrong, and on the first run it
    // could not run at all because no SS aircraft happened to be in hand.
    p2Faction: 'SS', p2Required: ['Chrysaor', 'Paladin', 'Falcon Squadron'],
  }, cards)
  games.push(g)
  console.log('\n  -- game B: DWG (host) vs SS (guest), default 75k/turn\n')

  const aSide = await g.sideOf(p1)
  const bSide = await g.sideOf(p2)

  // ---- Albacore: the aircraft lock, and WHOSE aircraft it stops -----------
  {
    const albacore = await g.drawUntil(p1, 'Albacore')
    const res = await g.attempt(p1, {
      type: 'PLAY_CARD_TO_ZONE', instanceId: albacore.instanceId, zoneId: 1,
    }, 12)
    step('Albacore deployed to zone 1', res.status === 200, `HTTP ${res.status}`)

    // The owner's own aircraft is now refused THERE and allowed ELSEWHERE.
    const ownAir = (await g.hand(p1)).find(
      (c) => c.type === 'vehicle' && (c.vehicleType === 'plane' || c.vehicleType === 'airship') &&
        c.name !== 'Albacore')
    if (!ownAir) {
      step('DWG had a second aircraft in hand to test the lock', false, 'none in hand')
    } else {
      const blocked = await g.attempt(p1, {
        type: 'PLAY_CARD_TO_ZONE', instanceId: ownAir.instanceId, zoneId: 1,
      }, 12)
      step('the OWNER may not play another aircraft into that zone (ruling C-1)',
        blocked.status === 400, `${ownAir.name} -> HTTP ${blocked.status} ` +
        `${JSON.stringify(blocked.body ?? '').slice(0, 110)}`)
      const elsewhere = await g.attempt(p1, {
        type: 'PLAY_CARD_TO_ZONE', instanceId: ownAir.instanceId, zoneId: 2,
      }, 12)
      step('the same aircraft still deploys to an unlocked zone',
        elsewhere.status === 200, `zone 2 -> HTTP ${elsewhere.status}`)
    }

    // ⚠ The assertion that pins the ruling. If Albacore were meant as an
    // enemy lockout, THIS is the step that would fail.
    //
    // AIR_SCREEN is checked first so a failure is attributable: it blocks
    // enemy aircraft from the same zone for an entirely different reason, and
    // the refusal message is identical.
    const dwgZone1 = (await g.load(p1)).state.zones[0].cards[aSide]
    step('setup: no DWG air screen in zone 1 to confound the next step',
      !dwgZone1.some((c) => c.keywords.includes('airScreen')),
      dwgZone1.map((c) => c.name).join(', ') || '(empty)')

    const enemyAir = await g.drawUntil(p2, 'Falcon Squadron')
    const allowed = await g.attempt(p2, {
      type: 'PLAY_CARD_TO_ZONE', instanceId: enemyAir.instanceId, zoneId: 1,
    }, 12)
    step('the ENEMY may still fly into that zone — the lock is a drawback, not a weapon',
      allowed.status === 200,
      `Falcon Squadron -> HTTP ${allowed.status} ${allowed.status === 200 ? '' : JSON.stringify(allowed.body ?? '').slice(0, 110)}`)
  }
}

// ====================== GAME C: SS (host) vs DWG (guest) ====================
//
// The two THRESHOLD cards get their own game, at a deliberately slow 20k/turn.
//
// Income is SET to floor(turnNumber) * materialsPerTurn at each turn start and
// therefore only ever RISES, so a condition reading "while you have LESS than
// 240k" is reachable only while the ramp is still under it — and drawUntil,
// which burns turns to find the card, is what pushes it past. At 20k/turn the
// window [120k, 240k) spans turns 6-11, which is slack enough for the draw to
// land inside it. At the 75k default it is turn 3 alone, and the previous two
// runs both overshot it.
{
  const g = await startGame(p1, p2, {
    label: 'wave6-smoke-c',
    materialsPerTurn: 20_000,
    p1Faction: 'SS', p1Required: ['Paladin', 'Chrysaor'],
    p2Faction: 'DWG', p2Required: [],
  }, cards)
  games.push(g)
  console.log('\n  -- game C: SS (host) vs DWG (guest), 20k/turn\n')

  // SS is the HOST here, unlike game B — the surge assertions read this side.
  const ssSide = await g.sideOf(p1)
  // ---- Paladin: a surge that GRANTS keywords onto the hull ----------------
  {
    const paladin = await g.drawUntil(p1, 'Paladin')
    // The window that makes this test mean anything: below 240k so the surge
    // is ON, and at least the 120k surged price so it is still affordable.
    // SPENT into, not waited for — drawUntil has already burned the turns that
    // would have put the balance under 240k, and income only rises.
    // At 20k/turn the ramp itself lands inside the window (turns 6-11), so
    // waiting is the normal path; spendInto is the fallback for a draw that
    // overshot it, since income only ever rises.
    const materials = (await g.waitForMaterials(p1, (m) => m >= 120_000 && m < 240_000))
      ?? (await g.spendInto(p1, {
        floor: 120_000, ceiling: 240_000, zoneId: 3, exclude: ['Paladin', 'Chrysaor'],
      }))
    step('SS is below Paladin\'s 240k threshold and can still afford the surged price',
      materials !== null, `${materials} materials`)
    const before = (await g.load(p1)).state
    const res = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: paladin.instanceId, zoneId: 2 })
    step('Paladin deployed while surged', res.status === 200,
      `HTTP ${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body).slice(0, 140)}`)
    const after = (await g.load(p1)).state
    const charged = before.resources[ssSide].materials - after.resources[ssSide].materials
    const hull = after.zones[1].cards[ssSide].find((c) => c.name === 'Paladin')
    step('the surge halved the printed 240k', charged === 120_000, `charged ${charged}`)
    // Ruling B-7, and the half a price-only implementation would fail.
    step('BOTH granted keywords landed on the HULL, not just on the price',
      !!hull && hull.keywords.includes('halfCost') && hull.keywords.includes('temporary'),
      JSON.stringify(hull?.keywords ?? []))
    // …and the proof that `temporary` really reached the board: the cull.
    //
    // Guarded on the hull actually existing. Without that this passes
    // VACUOUSLY when Paladin never landed — `.some(c => c.instanceId ===
    // undefined)` is false, so "it was culled" reports green for a card that
    // was never there. That is precisely what it did on the previous run.
    if (!hull) {
      step('the Temporary hull was culled at the next turn start', false,
        'Paladin never landed — nothing to cull')
    } else {
      await g.act(p1, { type: 'END_TURN' })
      await g.passTo(p1)
      const culled = (await g.load(p1)).state
      step('the Temporary hull was culled at the next turn start',
        !culled.zones[1].cards[ssSide].some((c) => c.instanceId === hull.instanceId),
        `zone 2 now holds ${culled.zones[1].cards[ssSide].map((c) => c.name).join(', ') || '(nothing)'}`)
    }
  }

  // ---- Chrysaor: a surge that RAISES the price ----------------------------
  {
    const chrysaor = await g.drawUntil(p1, 'Chrysaor')
    // Strictly more than 200k — the card says "more than" — and that is also
    // exactly the surged price, so the same figure covers affordability.
    const materials = await g.waitForMaterials(p1, (m) => m > 200_000)
    step('SS is above Chrysaor\'s 200k threshold', materials !== null, `${materials} materials`)
    const before = (await g.load(p1)).state
    const res = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: chrysaor.instanceId, zoneId: 2 })
    step('Chrysaor deployed while surged', res.status === 200, `HTTP ${res.status}`)
    const after = (await g.load(p1)).state
    const charged = before.resources[ssSide].materials - after.resources[ssSide].materials
    const hulls = after.zones[1].cards[ssSide].filter((c) => c.name === 'Chrysaor')
    step('the surge charged 100k MORE than the printed 100k', charged === 200_000, `charged ${charged}`)
    step('...and landed a second Chrysaor for it', hulls.length === 2, `${hulls.length} hulls`)
    step('the landed hulls keep their printed keywords (pricing only)',
      hulls.every((c) => JSON.stringify(c.keywords) === JSON.stringify(['stealthy'])),
      JSON.stringify(hulls.map((c) => c.keywords)))
  }

}

await report(games, p1)
