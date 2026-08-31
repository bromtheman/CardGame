#!/usr/bin/env node
// Live smoke test for effect-coverage wave 5, against the REAL deployed
// backend. Same reason wave 4's exists: the riskiest surfaces here are edge
// function code and jsonb round-trips, neither of which `tsc` reads and
// neither of which a unit test can reach. A regression in either is a card
// that silently does nothing in production while every check stays green.
//
// What it proves, end to end through the deployed function:
//
//   * game-action's catalog probe, source 4, for THREE new rider names —
//     ambushEffect, ongoingAttritionEffect, recurringThreatEffect. A rider is
//     dispatched by the registry name its zoneEffects entry stores, and the
//     dispatcher mints its payload card FROM THE CATALOG, so a name missing
//     from CATALOG_EFFECTS is a rider that never fires.
//   * the lock rider pass reaching the ATTACKER's own riders (DP2 departure
//     8) — Ambush and Ongoing Attrition both fire on a battle their owner
//     declares, which wave 4's defender-only pass could not reach.
//   * ZoneEffect's two new fields surviving jsonb: `expiresOnTurn` (swept by
//     endTurn's ending-side pass) and `data` (Recurring Threat's remembered
//     hull, a whole SnapshotCard, and Sub Killer's blocksFaction).
//   * state.scheduled as a real union — sabotageWatch resolving for the
//     ending side.
//
// Usage:  node scripts/smoke-wave5.mjs [--keep]
//   --keep   leave the games and lobbies behind for browser inspection
//
// Credentials come from scripts/qa-accounts.local (gitignored). Passwords are
// read into memory, sent only to /auth/v1/token, and never printed or stored.

// Plumbing lives in smoke-lib.mjs since wave 6 — this file is now just
// wave 5's scenarios. Re-running it after that extraction is what proved
// the extraction behaviour-preserving.
import {
  keep, die, step, results,
  rest, fn, signIn,
  builtIns, startGame, report,
} from './smoke-lib.mjs'


// --------------------------------------------------------------------- run

console.log('\n  Wave 5 live smoke test — real backend, real edge functions\n')

const p1 = await signIn('P1')
const p2 = await signIn('P2')
step('signed in both QA accounts', true, `${p1.email} / ${p2.email}`)

const cards = await builtIns(p1.token)
step('fetched the built-in catalog', cards.length > 100, `${cards.length} cards`)

const games = []

// ============================ GAME A: DWG vs OW =========================
// Recurring Threat and Ongoing Attrition (host, DWG); Sub Killer and Sabotage
// (guest, OW). Loggerhead is the DWG airship Sub Killer needs as a target.
{
  const g = await startGame(p1, p2, {
    label: 'wave5-smoke',
    p1Faction: 'DWG', p1Required: ['Recurring Threat', 'Ongoing Attrition', 'Loggerhead'],
    p2Faction: 'OW', p2Required: ['Sub Killer', 'Sabotage'],
  }, cards)
  games.push(g)
  console.log('\n  -- game A: DWG (host) vs OW (guest)\n')

  // ---- Recurring Threat: destroy a friendly hull, then be attacked there --
  const threat = await g.drawUntil(p1, 'Recurring Threat')
  const doomed = await g.deployShip(p1, 1)
  if (!doomed) die('host could not deploy a hull to zone 1')
  const keeper = await g.deployShip(p1, 1)
  if (!keeper) die('host could not deploy a second hull to zone 1')

  const cast = await g.attempt(p1, {
    type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD',
    instanceId: threat.instanceId, targetInstanceId: doomed.instanceId,
  })
  step('Recurring Threat destroyed a friendly hull', cast.status === 200,
    cast.status === 200 ? doomed.name : JSON.stringify(cast.body).slice(0, 300))

  let game = await g.load(p1)
  const marker = (game.state.zoneEffects ?? []).find((e) => e.effect === 'recurringThreatEffect')
  step('the marker persisted with the hull SNAPSHOT in ZoneEffect.data',
    marker?.data?.summon?.name === doomed.name && marker.expiresOnTurn === undefined,
    `data.summon=${marker?.data?.summon?.name ?? 'none'} expiresOnTurn=${marker?.expiresOnTurn}`)

  // The guest needs a hull in zone 1, deployed a turn earlier so it may act.
  const raider = await g.deployShip(p2, 1)
  if (!raider) die('guest could not deploy a hull to zone 1')
  await g.passTo(p2)

  game = await g.load(p2)
  const gSide = game.player_a === p2.userId ? 'a' : 'b'
  const hSide = gSide === 'a' ? 'b' : 'a'
  const zone1 = game.state.zones.find((z) => z.id === 1)
  const attack = await g.act(p2, {
    type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
    attackerIds: zone1.cards[gSide].map((c) => c.instanceId),
    targetIds: zone1.cards[hSide].map((c) => c.instanceId),
  })
  step('guest attacked into the marked zone', attack.status === 200,
    attack.status === 200 ? '' : JSON.stringify(attack.body).slice(0, 300))
  await g.lockIfPending(p1)

  game = await g.load(p1)
  const pending = game.state.pendingEffect
  step('catalog probe source 4 — the spent ability offered its remembered hull',
    pending?.card?.name === 'Recurring Threat' && pending.options?.[0]?.label === doomed.name,
    `pendingEffect=${pending ? `${pending.card.name} owed to ${pending.side}` : 'null'}` +
    ` options=${JSON.stringify((pending?.options ?? []).map((o) => o.label))}`)

  if (pending) {
    const resolved = await g.act(p1, { type: 'RESOLVE_PENDING_EFFECT', choiceId: pending.options[0].id })
    step('accepting minted the hull from the STORED SNAPSHOT, not the catalog', resolved.status === 200,
      resolved.status === 200 ? '' : JSON.stringify(resolved.body).slice(0, 300))
    game = await g.load(p1)
    const summons = (game.state.activeBattle?.summons ?? []).map((s) => s.name)
    const onBoard = game.state.zones.find((z) => z.id === 1).cards[hSide].map((c) => c.instanceId)
    step('the summon is in the battle and NOT on the board',
      summons.includes(doomed.name) &&
      !onBoard.includes(game.state.activeBattle?.summons?.[0]?.instanceId),
      `summons=${JSON.stringify(summons)} defenders=${game.state.activeBattle?.defenderIds?.length}`)
  }

  // Report the battle away so the board is usable again. The guest submits,
  // the host approves; everything at 100% so nothing dies but the summon.
  game = await g.load(p1)
  if (game.state.activeBattle) {
    const battle = game.state.activeBattle
    const ids = [...battle.attackerIds, ...battle.defenderIds]
    const submitted = await g.act(p2, {
      type: 'SUBMIT_BATTLE_REPORT',
      results: Object.fromEntries(ids.map((id) => [id, 100])), repairs: [],
    })
    if (submitted.status !== 200) die(`report submit failed (HTTP ${submitted.status}): ${JSON.stringify(submitted.body).slice(0, 300)}`)
    // Count, do not name: Recurring Threat already put a snapshot of THIS
    // card in the discard when it destroyed the original, so "no card by that
    // name in state.destroyed" can never be true and would fail whatever the
    // summon did. Nothing in this report is below the survive line, so the
    // pile must be exactly as long afterwards as before.
    const discardBefore = (await g.load(p1)).state.destroyed[hSide].length
    const decided = await g.act(p1, { type: 'DECIDE_BATTLE_REPORT', approve: true })
    const after = await g.load(p1)
    step('the summon evaporated on approval, adding nothing to the discard',
      decided.status === 200 && after.state.destroyed[hSide].length === discardBefore &&
      after.state.activeBattle === null,
      `discard ${discardBefore} -> ${after.state.destroyed[hSide].length}`)
  }

  // ---- Sub Killer: remove a DWG airship, and leave a GT block ------------
  const logger = await g.drawUntil(p1, 'Loggerhead')
  const flown = await g.attempt(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: logger.instanceId, zoneId: 2 })
  step('host deployed a Loggerhead into zone 2', flown.status === 200,
    flown.status === 200 ? '' : JSON.stringify(flown.body).slice(0, 300))

  const killer = await g.drawUntil(p2, 'Sub Killer')
  const killed = await g.attempt(p2, {
    type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD',
    instanceId: killer.instanceId, targetInstanceId: logger.instanceId,
  })
  step('Sub Killer removed the airship from play', killed.status === 200,
    killed.status === 200 ? '' : JSON.stringify(killed.body).slice(0, 300))

  game = await g.load(p2)
  const block = (game.state.zoneEffects ?? []).find((e) => e.effect === 'subKillerEffect')
  step('the GT block persisted with expiresOnTurn and data.blocksFaction',
    block?.data?.blocksFaction === 'GT' && typeof block.expiresOnTurn === 'number',
    `data=${JSON.stringify(block?.data)} expiresOnTurn=${block?.expiresOnTurn}`)

  // Expire it HERE, on the very next END_TURN, rather than several steps later:
  // a rest-of-turn rider is gone by the end of the turn that set it, so any
  // later check is asserting against a board that has already moved on.
  const endedNow = await g.act(p2, { type: 'END_TURN' })
  if (endedNow.status !== 200) die(`END_TURN failed (HTTP ${endedNow.status})`)
  game = await g.load(p2)
  step('the rest-of-turn GT block expired at its owner\'s next END_TURN',
    !(game.state.zoneEffects ?? []).some((e) => e.effect === 'subKillerEffect') &&
    (game.state.zoneEffects ?? []).some((e) => e.effect === 'recurringThreatEffect'),
    `riders now = ${JSON.stringify((game.state.zoneEffects ?? []).map((e) => e.effect))}`)

  // ---- Sabotage: FRAGILE now, a draw at the guest's own END_TURN ---------
  const sabotage = await g.drawUntil(p2, 'Sabotage')
  await g.passTo(p2)
  game = await g.load(p2)
  const victim = game.state.zones.flatMap((z) => z.cards[hSide])[0]
  if (!victim) die('no host hull left to sabotage')
  const sabotaged = await g.attempt(p2, {
    type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD',
    instanceId: sabotage.instanceId, targetInstanceId: victim.instanceId,
  })
  step('Sabotage gave a hull FRAGILE', sabotaged.status === 200,
    sabotaged.status === 200 ? victim.name : JSON.stringify(sabotaged.body).slice(0, 300))

  game = await g.load(p2)
  const watch = (game.state.scheduled ?? []).find((s) => s.type === 'sabotageWatch')
  step('the scheduled union carried a sabotageWatch through jsonb', watch !== undefined,
    JSON.stringify(game.state.scheduled))

  const handBefore = (await g.hand(p2)).length
  const ended = await g.act(p2, { type: 'END_TURN' })
  if (ended.status !== 200) die(`END_TURN failed (HTTP ${ended.status})`)
  game = await g.load(p2)
  step('the guest drew on their OWN end of turn (the watch paid out)',
    (await g.hand(p2)).length === handBefore + 1,
    `hand ${handBefore} -> ${(await g.hand(p2)).length}`)
  step('the watch was dropped once it paid out',
    !(game.state.scheduled ?? []).some((s) => s.type === 'sabotageWatch'),
    JSON.stringify(game.state.scheduled))

  // ---- Ongoing Attrition: strike at the host's own fleet-attack lock -----
  const attrition = await g.drawUntil(p1, 'Ongoing Attrition')
  // Zone 3 is untouched, so the host can out-number there cleanly.
  await g.deployShip(p1, 3)
  await g.deployShip(p1, 3)
  await g.passTo(p2)
  const bait = await g.deployShip(p2, 3)
  if (!bait) die('guest could not deploy bait into zone 3')
  const claimed = await g.attempt(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: attrition.instanceId, zoneId: 3 })
  step('Ongoing Attrition claimed zone 3', claimed.status === 200,
    claimed.status === 200 ? '' : JSON.stringify(claimed.body).slice(0, 300))

  game = await g.load(p1)
  const zone3 = game.state.zones.find((z) => z.id === 3)
  const hpBefore = zone3.baseHp[gSide]
  const surplus = zone3.cards[hSide].length - zone3.cards[gSide].length
  const struck = await g.act(p1, {
    type: 'ATTACK_ENEMY_FLEET', zoneId: 3,
    attackerIds: [zone3.cards[hSide][0].instanceId],
    targetIds: [zone3.cards[gSide][0].instanceId],
  })
  await g.lockIfPending(p2)
  game = await g.load(p1)
  const hpAfter = game.state.zones.find((z) => z.id === 3).baseHp[gSide]
  step('the ATTACKER\'s own rider fired at lock and ground the base (DP2 departure 8)',
    struck.status === 200 && surplus > 0 && hpAfter === hpBefore - surplus * 40,
    `surplus=${surplus} baseHp ${hpBefore} -> ${hpAfter}`)
  step('a rider that dealt damage is spent, not left to draw',
    !((await g.load(p1)).state.zoneEffects ?? []).some((e) => e.effect === 'ongoingAttritionEffect'), '')
}

// ============================ GAME B: WF vs SS ==========================
// Ambush is a WF card, and no other wave-5 card is, so it needs its own game.
{
  const g = await startGame(p1, p2, {
    label: 'wave5-smoke',
    p1Faction: 'WF', p1Required: ['Ambush'],
    p2Faction: 'SS', p2Required: [],
  }, cards)
  games.push(g)
  console.log('\n  -- game B: WF (host) vs SS (guest)\n')

  const ambush = await g.drawUntil(p1, 'Ambush')
  const mine = await g.deployShip(p1, 1)
  if (!mine) die('host could not deploy a hull to zone 1')
  const theirs = await g.deployShip(p2, 1)
  if (!theirs) die('guest could not deploy a hull to zone 1')

  const set = await g.attempt(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: ambush.instanceId, zoneId: 1 })
  step('Ambush claimed zone 1', set.status === 200,
    set.status === 200 ? '' : JSON.stringify(set.body).slice(0, 300))

  let game = await g.load(p1)
  const rider = (game.state.zoneEffects ?? []).find((e) => e.effect === 'ambushEffect')
  step('the rider persisted with expiresOnTurn and data.drawOnExpiry',
    rider?.data?.drawOnExpiry === true && typeof rider.expiresOnTurn === 'number',
    `data=${JSON.stringify(rider?.data)} expiresOnTurn=${rider?.expiresOnTurn}`)

  const hSide = game.player_a === p1.userId ? 'a' : 'b'
  const gSide = hSide === 'a' ? 'b' : 'a'
  const zone1 = game.state.zones.find((z) => z.id === 1)
  const sprung = await g.act(p1, {
    type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
    attackerIds: [zone1.cards[hSide][0].instanceId],
    targetIds: [zone1.cards[gSide][0].instanceId],
  })
  step('host attacked out of the ambushed zone', sprung.status === 200,
    sprung.status === 200 ? '' : JSON.stringify(sprung.body).slice(0, 300))
  await g.lockIfPending(p2)

  game = await g.load(p1)
  const offer = game.state.pendingEffect
  step('catalog probe source 4 — the ambush rider fired for the ATTACKER',
    offer?.card?.name === 'Ambush' && offer.side === hSide,
    `pendingEffect=${offer ? `${offer.card.name} owed to ${offer.side}` : 'null'}`)
  step('the rider was consumed by the battle before the offer was made',
    !((game.state.zoneEffects ?? []).some((e) => e.effect === 'ambushEffect')), '')

  if (offer) {
    const distanceBefore = game.state.activeBattle.distanceM
    const took = await g.act(p1, { type: 'RESOLVE_PENDING_EFFECT', choiceId: offer.options[0].id })
    game = await g.load(p1)
    step('accepting moved the spawn distance 600m closer, sparing the hero power',
      took.status === 200 && game.state.activeBattle.distanceM === distanceBefore - 600 &&
      (game.state.activeBattle.distanceModifiedBy ?? []).length === 0,
      `distance ${distanceBefore} -> ${game.state.activeBattle?.distanceM}` +
      ` modifiedBy=${JSON.stringify(game.state.activeBattle?.distanceModifiedBy)}`)
    step('the log tells the DEFENDER about the deploy order',
      game.state.log.some((l) => l.includes('Ambush') && l.includes('after the defender')), '')
  }
}

// ------------------------------------------------------------------ report

await report(games, p1)
