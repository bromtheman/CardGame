#!/usr/bin/env node
// Live smoke test for the 2026-09-02 balance pass — the SS wave — against the
// REAL deployed backend. Plumbing lives in ./smoke-lib.mjs; this file is
// scenarios only.
//
// ⚠ Run this AFTER PR #54 is merged, its seed applied (`npm run seed:verify`
// clean) and `game-action` redeployed. Before that the seed block at the top
// fails first, and explains every later failure at once — the same trap wave 6
// walked into when the merge deployed code and nobody applied the data.
//
// What it proves that no unit test can:
//
//   * THE CATALOG PROBE for `paladinActivate`, the wave's only new
//     { needsCatalog: true } effect — and its trigger is an ACTIVATION, not a
//     play. makeCtx hands every unit test a catalog; only production shows
//     whether game-action fetches one for an ACTIVATE_VEHICLE press.
//   * THE LOAN THROUGH JSONB, MID-BATTLE. Sacrilego lends SCRAPPY from lock to
//     resolve via a per-hull `scrappyOnLoan` marker. The marker and the
//     keyword have to survive a round trip through Postgres between the two
//     actions, then come OFF at resolve — and the free repair has to be free.
//   * A TWO-HOP PENDING EFFECT THROUGH POSTGRES. Braveheart's second hop is
//     told apart by a stash in `pendingEffect.data`; the stash has to round
//     trip. Also the ruling that an impossible duel is REFUSED before the 1cp
//     is charged, and that client-supplied ids on the resolve are ignored.
//   * THE PRIVATE HAND STAMP. `handEnteredTurn` lives in `game_players.hand`,
//     not in public state; Tyr's price is the only thing that reads it, and
//     the client and server must agree on the number.
//   * SEEDED DATA DRIVING BEHAVIOUR — slotDenial, additionalSpawns, the
//     activated pair, R-3's 10k and R-5's "SS vehicle" are values in the
//     cards table, not code.
//
// ⚠ A live test whose result depends on the shuffle is not a test yet. Every
// card a scenario needs is `required`, the SS deck is EXACTLY its ten
// requirements twice over, and the income is picked so a 950k Tyr is
// affordable by turn 2. CP is never refilled in this game, so the CP budget
// is exact: 3 to start, +1 from Paladin, −1 Paladin's spawn, −1 Braveheart's
// duel, −2 Cash advance = 0. Reorder the scenarios and one of them starves.
//
// Usage:  node scripts/smoke-pass-2026-09-02.mjs [--keep]
//   --keep   leave the game and lobby behind for browser inspection
//
// Credentials come from scripts/qa-accounts.local (gitignored).

import { step, signIn, builtIns, startGame, report } from './smoke-lib.mjs'

console.log('\n  2026-09-02 balance pass — SS wave live smoke test\n')

const p1 = await signIn('P1')
const p2 = await signIn('P2')
step('signed in both QA accounts', true, `${p1.email} / ${p2.email}`)

const cards = await builtIns(p1.token)
step('fetched the built-in catalog', cards.length > 150, `${cards.length} cards`)

// ===================== the seed, before anything is played ==================
{
  const ss = new Map(cards.filter((c) => c.faction === 'SS').map((c) => [c.name, c]))
  const has = (name) => ss.has(name)
  step('the LIVE table holds the four new SS cards under their delivered names',
    has('Tiger Shark') && has('Thresher Shark') && has('Bull Shark') && has('Cash advance'),
    ['Tiger Shark', 'Thresher Shark', 'Bull Shark', 'Cash advance'].filter((n) => !has(n)).join(', ') || 'all four')
  step('"Cash advance" keeps its lowercase a — a retitle would be a different id',
    !has('Cash Advance'), '')
  step('Tiger Shark carries slotDenial 3 (R-1)',
    ss.get('Tiger Shark')?.meta?.slotDenial === 3, JSON.stringify(ss.get('Tiger Shark')?.meta ?? {}))
  step('Paladin carries the on-play + activated pair and no stale surge',
    ss.get('Paladin')?.meta?.onPlayEffect === 'paladinOnPlay' &&
    ss.get('Paladin')?.meta?.onActivate === 'paladinActivate' &&
    ss.get('Paladin')?.meta?.activateCpCost === 1 &&
    ss.get('Paladin')?.meta?.resourceSurge === undefined,
    JSON.stringify(ss.get('Paladin')?.meta ?? {}))
  step('Braveheart still carries its activated pair',
    ss.get('Braveheart')?.meta?.onActivate === 'braveheartActivate' && ss.get('Braveheart')?.meta?.activateCpCost === 1,
    JSON.stringify(ss.get('Braveheart')?.meta ?? {}))
  step('Victoria is an on-play hand target with no activation price left',
    ss.get('Victoria')?.meta?.playOnCardEffect === 'victoriaOnPlay' &&
    ss.get('Victoria')?.meta?.onActivate === undefined && ss.get('Victoria')?.meta?.activateMaterialCost === undefined,
    JSON.stringify(ss.get('Victoria')?.meta ?? {}))
  step('Sacrilego is 10,000 materials (R-3) and keeps Scrappy',
    ss.get('Sacrilego')?.material_cost === 10000 && (ss.get('Sacrilego')?.keywords ?? []).includes('scrappy'),
    `material_cost=${ss.get('Sacrilego')?.material_cost} keywords=${JSON.stringify(ss.get('Sacrilego')?.keywords)}`)
  step('Nothung is 400k and no longer names a spawn',
    ss.get('Nothung')?.material_cost === 400000 && ss.get('Nothung')?.meta?.onPlayEffect === 'nothungOnPlay',
    `material_cost=${ss.get('Nothung')?.material_cost}`)
  step('Chrysaor surges over 150k for +75k, at 75k',
    ss.get('Chrysaor')?.material_cost === 75000 &&
    JSON.stringify(ss.get('Chrysaor')?.meta?.resourceSurge) === JSON.stringify({ materialsOver: 150000, extraSpawns: 1, costDelta: 75000 }),
    JSON.stringify(ss.get('Chrysaor')?.meta?.resourceSurge ?? null))
  step('Typhoon dropped Blocker and arrives in pairs by DATA',
    (ss.get('Typhoon')?.keywords ?? []).length === 0 && ss.get('Typhoon')?.meta?.additionalSpawns === 1 &&
    Object.keys(ss.get('Typhoon')?.meta ?? {}).length === 1,
    JSON.stringify({ keywords: ss.get('Typhoon')?.keywords, meta: ss.get('Typhoon')?.meta }))
  step('Argonaut carries Scrappy AND a death trigger, deliberately (R-4)',
    (ss.get('Argonaut')?.keywords ?? []).includes('scrappy') && ss.get('Argonaut')?.meta?.onDeathEffect === 'argonautOnDeath', '')
  step('Repairmen Ready prints "SS vehicle", not "AI vehicle" (R-5)',
    /an SS vehicle/.test(ss.get('Repairmen Ready')?.card_text ?? '') && !/AI vehicle/.test(ss.get('Repairmen Ready')?.card_text ?? ''),
    ss.get('Repairmen Ready')?.card_text ?? '')
  step('Asphodel gained Stealthy at 400k',
    ss.get('Asphodel')?.material_cost === 400000 && (ss.get('Asphodel')?.keywords ?? []).includes('stealthy'), '')
}

// ================ the game: SS (host) vs DWG (guest), 600k/turn =============
//
// 600k/turn puts the 950k Tyr and the 690k Tiger Shark inside turn 2 without
// making anything below unreachable — nothing here keys off a materials
// threshold (Thresher Shark's surge does, and is deliberately not in this deck
// for exactly that reason; wave 6's harness lost two runs to a threshold it
// had spent past).
const g = await startGame(p1, p2, {
  label: 'pass-2026-09-02-ss',
  materialsPerTurn: 600_000,
  p1Faction: 'SS',
  p1Required: ['Tyr', 'Tiger Shark', 'Paladin', 'Braveheart', 'Victoria', 'Nothung', 'Typhoon', 'Sacrilego', 'Bull Shark', 'Cash advance'],
  p2Faction: 'DWG',
  p2Required: ['Corsair', 'Marauder'],
}, cards)
const games = [g]
console.log('\n  -- SS (host) vs DWG (guest), 600k/turn\n')

const aSide = await g.sideOf(p1)
const bSide = await g.sideOf(p2)
const state = async (who = p1) => (await g.load(who)).state
const zoneOf = (st, zoneId) => st.zones.find((z) => z.id === zoneId)
const logSince = (before, after) => after.state.log.slice(before.state.log.length)
const ssShipsInHand = async () => (await g.hand(p1)).filter(
  (c) => c.faction === 'SS' && c.type === 'vehicle' && c.vehicleType === 'ship')

// Hand the turn back to p1 after burning one FULL round (p1 ends, p2 ends).
async function burnRound() {
  await g.passTo(p1)
  let res = await g.act(p1, { type: 'END_TURN' })
  if (res.status !== 200) throw new Error(`END_TURN failed (HTTP ${res.status})`)
  res = await g.act(p2, { type: 'END_TURN' })
  if (res.status !== 200) throw new Error(`END_TURN failed (HTTP ${res.status})`)
}

// ---- Tyr: the private hand stamp, and the price it drives ------------------
{
  const tyr = await g.drawUntil(p1, 'Tyr')
  step('handEnteredTurn rode into game_players.hand through jsonb',
    typeof tyr.handEnteredTurn === 'number', `handEnteredTurn=${tyr.handEnteredTurn}`)
  const publicState = await state(p1)
  const leaked = JSON.stringify(publicState).includes('handEnteredTurn')
  step('the stamp is nowhere in PUBLIC state', !leaked, '')

  // Hold it for at least one full round, then be sure it is affordable.
  await burnRound()
  const afford = await g.waitForMaterials(p1, (m) => m >= 950_000)
  step('setup: Tyr is affordable at its printed price', afford !== null, `materials=${afford}`)
  const before = await g.load(p1)
  const held = (await g.hand(p1)).find((c) => c.name === 'Tyr')
  const roundsHeld = Math.max(0, Math.floor(before.turn_number - held.handEnteredTurn))
  const expected = 950_000 - 60_000 * roundsHeld
  const res = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: held.instanceId, zoneId: 3 })
  step('Tyr deployed', res.status === 200, `HTTP ${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body).slice(0, 160)}`)
  const after = await g.load(p1)
  const charged = before.state.resources[aSide].materials - after.state.resources[aSide].materials
  step('Tyr cost 60k less for every full round it waited in hand (server price)',
    roundsHeld >= 1 && charged === expected,
    `held ${roundsHeld} round(s): charged ${charged}, expected ${expected} (turn ${before.turn_number}, entered ${held.handEnteredTurn})`)
  const onBoard = zoneOf(after.state, 3).cards[aSide].find((c) => c.name === 'Tyr')
  step('the placed hull does not carry the hand stamp',
    !!onBoard && !('handEnteredTurn' in onBoard), '')
}

// ---- Tiger Shark: slotDenial as seeded data on a live board ---------------
{
  const shark = await g.drawUntil(p1, 'Tiger Shark')
  await g.waitForMaterials(p1, (m) => m >= 690_000)
  const res = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: shark.instanceId, zoneId: 1 })
  step('Tiger Shark deployed into zone 1', res.status === 200, `HTTP ${res.status}`)
  const entry = zoneOf(await state(p1), 1).cards[aSide].find((c) => c.name === 'Tiger Shark')
  step('the board entry carries slotDenial 3 through jsonb — the value zoneCapFor reads',
    entry?.meta?.slotDenial === 3, JSON.stringify(entry?.meta ?? {}))
}

// ---- Paladin: +1cp on play, then a CATALOG spawn on activation -------------
{
  const paladin = await g.drawUntil(p1, 'Paladin')
  await g.waitForMaterials(p1, (m) => m >= 240_000)
  const cpBefore = (await state(p1)).resources[aSide].cp
  const res = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: paladin.instanceId, zoneId: 1 })
  step('Paladin deployed into zone 1', res.status === 200, `HTTP ${res.status}`)
  const cpAfter = (await state(p1)).resources[aSide].cp
  step('Paladin paid a CP forward on play', cpAfter === cpBefore + 1, `cp ${cpBefore} -> ${cpAfter}`)

  await burnRound()
  const before = await state(p1)
  const mine = zoneOf(before, 1).cards[aSide].filter((c) => c.name === 'Paladin')
  const act = await g.act(p1, { type: 'ACTIVATE_VEHICLE', instanceId: mine[0].instanceId })
  step('Paladin activated for its seeded 1cp',
    act.status === 200, `HTTP ${act.status} ${act.status === 200 ? '' : JSON.stringify(act.body).slice(0, 160)}`)
  const after = await state(p1)
  const now = zoneOf(after, 1).cards[aSide].filter((c) => c.name === 'Paladin')
  step('catalog probe on an ACTIVATION: a second Paladin was mustered into the SAME zone',
    now.length === mine.length + 1 && after.zones.every((z) => z.id === 1 || !z.cards[aSide].some((c) => c.name === 'Paladin')),
    `zone 1 Paladins ${mine.length} -> ${now.length}`)
  step('exactly 1cp was charged and the spawn granted none (spawning is not playing)',
    before.resources[aSide].cp - after.resources[aSide].cp === 1, `cp ${before.resources[aSide].cp} -> ${after.resources[aSide].cp}`)
  const spawned = now.find((c) => !mine.some((m) => m.instanceId === c.instanceId))
  step('the spawned Paladin carries its own ability, unstamped',
    spawned?.meta?.onActivate === 'paladinActivate' && spawned?.meta?.activateCpCost === 1 && spawned?.activatedOnTurn === null,
    JSON.stringify({ meta: spawned?.meta, activatedOnTurn: spawned?.activatedOnTurn }))
}

// ---- Braveheart: refused before charging, then two hops through Postgres ---
{
  const bh = await g.drawUntil(p1, 'Braveheart')
  await g.waitForMaterials(p1, (m) => m >= 350_000)
  const res = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: bh.instanceId, zoneId: 2 })
  step('Braveheart deployed into an EMPTY zone 2', res.status === 200, `HTTP ${res.status}`)

  // No enemy in the zone: refused, and nothing sticks.
  await burnRound()
  const dry = await state(p1)
  const hull = zoneOf(dry, 2).cards[aSide].find((c) => c.name === 'Braveheart')
  const refused = await g.act(p1, { type: 'ACTIVATE_VEHICLE', instanceId: hull.instanceId })
  const afterRefusal = await state(p1)
  step('an impossible duel is REFUSED (no enemy in the zone)', refused.status === 400, `HTTP ${refused.status}`)
  step('…and nothing stuck: cp unchanged, no activation stamp, no pending choice',
    afterRefusal.resources[aSide].cp === dry.resources[aSide].cp &&
    zoneOf(afterRefusal, 2).cards[aSide].find((c) => c.name === 'Braveheart')?.activatedOnTurn === null &&
    afterRefusal.pendingEffect === null,
    `cp ${dry.resources[aSide].cp} -> ${afterRefusal.resources[aSide].cp}`)

  // Now give it an enemy.
  const enemy = await g.deployShip(p2, 2)
  step('DWG deployed a ship into zone 2', !!enemy, enemy?.name ?? 'none')
  await g.passTo(p1)
  const before = await state(p1)
  const one = await g.act(p1, { type: 'ACTIVATE_VEHICLE', instanceId: hull.instanceId })
  step('Braveheart activated', one.status === 200, `HTTP ${one.status} ${one.status === 200 ? '' : JSON.stringify(one.body).slice(0, 160)}`)
  const hop1 = await state(p1)
  const friendlyShips = new Set(zoneOf(hop1, 2).cards[aSide].filter((c) => c.vehicleType === 'ship').map((c) => c.instanceId))
  step('hop 1 offers YOUR SHIPS in the zone (Braveheart itself included)',
    hop1.pendingEffect?.effect === 'braveheartActivate' &&
    hop1.pendingEffect.options.length > 0 &&
    hop1.pendingEffect.options.every((o) => friendlyShips.has(o.id)),
    `options=${JSON.stringify(hop1.pendingEffect?.options?.map((o) => o.label) ?? [])}`)
  // Client-supplied zoneId/targetInstanceId are ignored on BOTH resolves.
  const two = await g.act(p1, { type: 'RESOLVE_PENDING_EFFECT', choiceId: hull.instanceId, zoneId: 3, targetInstanceId: 'nope' })
  step('hop 1 resolved into hop 2', two.status === 200, `HTTP ${two.status}`)
  const hop2 = await state(p1)
  const enemies = new Set(zoneOf(hop2, 2).cards[bSide].map((c) => c.instanceId))
  step('hop 2 offers the ENEMY VEHICLES in the same zone, keyed off a stash that round-tripped',
    hop2.pendingEffect?.effect === 'braveheartActivate' &&
    hop2.pendingEffect.options.length === enemies.size &&
    hop2.pendingEffect.options.every((o) => enemies.has(o.id)) &&
    hop2.pendingEffect.data?.fighterId === hull.instanceId,
    `options=${JSON.stringify(hop2.pendingEffect?.options?.map((o) => o.label) ?? [])} stash=${JSON.stringify(hop2.pendingEffect?.data ?? null)}`)
  const target = hop2.pendingEffect.options[0].id
  const three = await g.act(p1, { type: 'RESOLVE_PENDING_EFFECT', choiceId: target, zoneId: 3, targetInstanceId: 'nope' })
  step('hop 2 resolved into the 1v1', three.status === 200, `HTTP ${three.status}`)
  const fought = await state(p1)
  const battle = fought.activeBattle
  step('the forced battle is the chosen ship vs the chosen vehicle, in Braveheart\'s own zone',
    battle?.zoneId === 2 && battle?.aggressor === aSide &&
    JSON.stringify(battle?.attackerIds) === JSON.stringify([hull.instanceId]) &&
    JSON.stringify(battle?.defenderIds) === JSON.stringify([target]),
    JSON.stringify(battle ? { zoneId: battle.zoneId, aggressor: battle.aggressor, attackers: battle.attackerIds, defenders: battle.defenderIds } : null))
  step('a forced battle is not a zone activation', zoneOf(fought, 2).lastActivatedTurn === null, '')
  step('1cp was charged once across both hops',
    before.resources[aSide].cp - fought.resources[aSide].cp === 1, `cp ${before.resources[aSide].cp} -> ${fought.resources[aSide].cp}`)

  // Settle it: Braveheart wins, so zone 2 is clear again.
  const results = { [hull.instanceId]: 100, [target]: 0 }
  const sub = await g.act(p1, { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] })
  step('duel reported', sub.status === 200, `HTTP ${sub.status}`)
  const dec = await g.act(p2, { type: 'DECIDE_BATTLE_REPORT', approve: true })
  step('duel approved', dec.status === 200, `HTTP ${dec.status}`)
}

// ---- Victoria: an on-play hand target, and a discount by costDelta ---------
{
  const victoria = await g.drawUntil(p1, 'Victoria')
  const ships = (await ssShipsInHand()).filter((c) => c.instanceId !== victoria.instanceId)
  step('setup: an SS ship is in hand for Victoria to discount', ships.length > 0, `${ships.length} candidates`)
  const target = ships[0]
  await g.waitForMaterials(p1, (m) => m >= 270_000)
  const before = await g.load(p1)
  const res = await g.act(p1, {
    type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: victoria.instanceId, targetInstanceId: target.instanceId, zoneId: 3,
  })
  step('Victoria deployed while naming a ship in hand',
    res.status === 200, `HTTP ${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body).slice(0, 160)}`)
  const after = await g.load(p1)
  const held = (await g.hand(p1)).find((c) => c.instanceId === target.instanceId)
  step('the chosen ship is 75k cheaper, by costDelta, in the PRIVATE hand row',
    held?.meta?.costDelta === (target.meta?.costDelta ?? 0) - 75_000 && held?.materialCost === target.materialCost,
    `costDelta ${target.meta?.costDelta ?? 0} -> ${held?.meta?.costDelta} (materialCost still ${held?.materialCost})`)
  step('the public log never names the card in hand',
    !logSince(before, after).some((l) => l.includes(target.name)), JSON.stringify(logSince(before, after)))
}

// ---- Nothung: every SS ship in hand, 40k cheaper, and a log that counts nothing
{
  const nothung = await g.drawUntil(p1, 'Nothung')
  const handBefore = await ssShipsInHand()
  await g.waitForMaterials(p1, (m) => m >= 400_000)
  const before = await g.load(p1)
  const res = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: nothung.instanceId, zoneId: 3 })
  step('Nothung deployed', res.status === 200, `HTTP ${res.status}`)
  const after = await g.load(p1)
  const handAfter = await g.hand(p1)
  const moved = handBefore.filter((c) => c.instanceId !== nothung.instanceId)
  step('every SS ship still in hand is exactly 40k cheaper than before',
    moved.length > 0 && moved.every((c) => {
      const now = handAfter.find((h) => h.instanceId === c.instanceId)
      return now && now.meta?.costDelta === (c.meta?.costDelta ?? 0) - 40_000
    }),
    moved.map((c) => `${c.name}: ${c.meta?.costDelta ?? 0} -> ${handAfter.find((h) => h.instanceId === c.instanceId)?.meta?.costDelta}`).join(', '))
  const lines = logSince(before, after)
  step('the public log carries neither a hand card\'s name nor a COUNT',
    lines.length > 0 && !lines.some((l) => /\d/.test(l) || moved.some((c) => l.includes(c.name))), JSON.stringify(lines))
}

// ---- Typhoon: two hulls off one payment, by data ---------------------------
{
  const typhoon = await g.drawUntil(p1, 'Typhoon')
  await g.waitForMaterials(p1, (m) => m >= 130_000)
  const before = await state(p1)
  const res = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: typhoon.instanceId, zoneId: 3 })
  step('Typhoon deployed', res.status === 200, `HTTP ${res.status}`)
  const after = await state(p1)
  const was = zoneOf(before, 3).cards[aSide].filter((c) => c.name === 'Typhoon').length
  const now = zoneOf(after, 3).cards[aSide].filter((c) => c.name === 'Typhoon').length
  step('two Typhoons landed off ONE payment (additionalSpawns, no effect involved)',
    now === was + 2 && before.resources[aSide].materials - after.resources[aSide].materials === 130_000,
    `Typhoons ${was} -> ${now}, charged ${before.resources[aSide].materials - after.resources[aSide].materials}`)
}

// ---- Sacrilego's loan and Bull Shark's bombardment, in one zone-1 battle ---
{
  const sac = await g.drawUntil(p1, 'Sacrilego')
  const played = await g.attempt(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: sac.instanceId, zoneId: 1 })
  step('Sacrilego deployed into zone 1 for 10k', played.status === 200, `HTTP ${played.status}`)
  const bull = await g.drawUntil(p1, 'Bull Shark')
  await g.waitForMaterials(p1, (m) => m >= 640_000)
  const bullRes = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: bull.instanceId, zoneId: 1 })
  step('Bull Shark deployed into zone 1', bullRes.status === 200, `HTTP ${bullRes.status}`)

  const enemy = await g.deployShip(p2, 1)
  step('DWG deployed a ship into zone 1 (under a Tiger Shark\'s reduced cap)', !!enemy, enemy?.name ?? 'none')
  await g.passTo(p1)

  const staged = await state(p1)
  const zone1 = zoneOf(staged, 1)
  const mine = zone1.cards[aSide]
  const theirs = zone1.cards[bSide]
  const lendee = mine.find((c) => c.name === 'Paladin')
  step('setup: a friendly non-Scrappy ship (a Paladin) stands beside Sacrilego',
    !!lendee && !lendee.keywords.includes('scrappy'), lendee ? JSON.stringify(lendee.keywords) : 'no Paladin')

  const attack = await g.act(p1, {
    type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
    attackerIds: mine.map((c) => c.instanceId), targetIds: theirs.map((c) => c.instanceId),
  })
  step('SS attacked the DWG fleet in zone 1', attack.status === 200, `HTTP ${attack.status} ${attack.status === 200 ? '' : JSON.stringify(attack.body).slice(0, 160)}`)
  await g.lockIfPending(p2)

  const locked = await state(p1)
  step('the battle is locked', !!locked.activeBattle && locked.activeBattle.zoneId === 1, JSON.stringify(locked.activeBattle ? { zoneId: locked.activeBattle.zoneId } : null))
  const lent = zoneOf(locked, 1).cards[aSide].find((c) => c.instanceId === lendee.instanceId)
  step('LOCK → the Paladin holds SCRAPPY on loan, marker and keyword both through jsonb',
    lent?.keywords.includes('scrappy') && lent?.meta?.scrappyOnLoan === true,
    JSON.stringify({ keywords: lent?.keywords, meta: lent?.meta }))
  const sacOnBoard = zoneOf(locked, 1).cards[aSide].find((c) => c.name === 'Sacrilego')
  step('a hull that PRINTS Scrappy was never marked', sacOnBoard?.meta?.scrappyOnLoan === undefined, JSON.stringify(sacOnBoard?.meta ?? {}))

  // Report: the Paladin sits in the repair band, so without the loan it would
  // die or cost a paid repair. Everything else survives clean; the enemy dies;
  // Bull Shark survives an OFFENSIVE battle.
  const results = {}
  for (const id of locked.activeBattle.attackerIds) results[id] = id === lendee.instanceId ? 85 : 100
  for (const id of locked.activeBattle.defenderIds) results[id] = 0
  const handBefore = await ssShipsInHand()
  const sub = await g.act(p1, { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] })
  step('battle report submitted', sub.status === 200, `HTTP ${sub.status} ${sub.status === 200 ? '' : JSON.stringify(sub.body).slice(0, 160)}`)
  const beforeDecide = await state(p1)
  const dec = await g.act(p2, { type: 'DECIDE_BATTLE_REPORT', approve: true })
  step('battle report approved', dec.status === 200, `HTTP ${dec.status} ${dec.status === 200 ? '' : JSON.stringify(dec.body).slice(0, 160)}`)

  const after = await state(p1)
  const survivor = zoneOf(after, 1).cards[aSide].find((c) => c.instanceId === lendee.instanceId)
  step('RESOLVE → the loan came back: the Paladin survived at 85% on a free repair and is no longer Scrappy',
    !!survivor && !survivor.keywords.includes('scrappy') && survivor.meta?.scrappyOnLoan === undefined,
    survivor ? JSON.stringify({ keywords: survivor.keywords, meta: survivor.meta }) : 'the Paladin is GONE')
  step('the repair was free (no materials left the owner at resolve)',
    after.resources[aSide].materials === beforeDecide.resources[aSide].materials,
    `materials ${beforeDecide.resources[aSide].materials} -> ${after.resources[aSide].materials}`)
  step('Bull Shark shelled the enemy base for 200 HP after surviving an offensive win',
    zoneOf(after, 1).baseHp[bSide] === zoneOf(beforeDecide, 1).baseHp[bSide] - 200,
    `enemy base ${zoneOf(beforeDecide, 1).baseHp[bSide]} -> ${zoneOf(after, 1).baseHp[bSide]}`)
  const handAfter = await g.hand(p1)
  step('Sacrilego survived, so every SS ship in hand is 30k cheaper',
    handBefore.length > 0 && handBefore.every((c) => {
      const now = handAfter.find((h) => h.instanceId === c.instanceId)
      return now && now.meta?.costDelta === (c.meta?.costDelta ?? 0) - 30_000
    }),
    handBefore.map((c) => `${c.name}: ${c.meta?.costDelta ?? 0} -> ${handAfter.find((h) => h.instanceId === c.instanceId)?.meta?.costDelta}`).join(', ') || 'no SS ship in hand')
}

// ---- Cash advance: the last 2cp, for 150k and a card ----------------------
{
  const cash = await g.drawUntil(p1, 'Cash advance')
  const before = await g.load(p1)
  const handBefore = (await g.hand(p1)).length
  step('setup: exactly 2cp remain for it', before.state.resources[aSide].cp === 2, `cp=${before.state.resources[aSide].cp}`)
  const res = await g.act(p1, { type: 'PLAY_ABILITY_CARD', instanceId: cash.instanceId })
  step('Cash advance played', res.status === 200, `HTTP ${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body).slice(0, 160)}`)
  const after = await g.load(p1)
  const handAfter = (await g.hand(p1)).length
  step('+150k materials, −2cp, and a card drawn to replace it',
    after.state.resources[aSide].materials - before.state.resources[aSide].materials === 150_000 &&
    before.state.resources[aSide].cp - after.state.resources[aSide].cp === 2 &&
    handAfter === handBefore,
    `materials +${after.state.resources[aSide].materials - before.state.resources[aSide].materials}, cp ${before.state.resources[aSide].cp} -> ${after.state.resources[aSide].cp}, hand ${handBefore} -> ${handAfter}`)
}

await report(games, p1)
