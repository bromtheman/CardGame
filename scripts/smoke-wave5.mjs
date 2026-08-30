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

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const keep = process.argv.includes('--keep')

// ------------------------------------------------------------------ config

function readEnvFile(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, eq).replace(/^export\s+/, '').trim()] = v
  }
  return out
}

const feEnv = readEnvFile(path.join(ROOT, 'frontend/.env.local'))
const accounts = readEnvFile(path.join(ROOT, 'scripts/qa-accounts.local'))
const BASE = feEnv.VITE_SUPABASE_URL
const ANON = feEnv.VITE_SUPABASE_PUBLISHABLE_KEY

function die(msg) { console.error(`\n  x ${msg}\n`); process.exitCode = 1; throw new Error(msg) }
if (!BASE || !ANON) die('frontend/.env.local must define VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY')
if (!accounts.P1_EMAIL || !accounts.P2_EMAIL) die('scripts/qa-accounts.local must define P1_* and P2_*')

// ------------------------------------------------------------------- steps

const results = []
function step(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

// ------------------------------------------------------------------ client

async function api(pathname, { method = 'GET', token, body, prefer } = {}) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token ?? ANON}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${BASE}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed }
}

async function signIn(prefix) {
  const res = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: accounts[`${prefix}_EMAIL`], password: accounts[`${prefix}_PASSWORD`] },
  })
  if (res.status !== 200 || !res.body?.access_token) {
    die(`${prefix} sign-in failed (HTTP ${res.status}) — check scripts/qa-accounts.local`)
  }
  return { token: res.body.access_token, userId: res.body.user.id, email: res.body.user.email }
}

const rest = (p, opts) => api(`/rest/v1${p}`, opts)
const fn = (name, token, body) => api(`/functions/v1/${name}`, { method: 'POST', token, body })

// ------------------------------------------------------------------- cards

async function builtIns(token) {
  const res = await rest(
    '/cards?is_built_in=eq.true&select=id,name,faction,type,vehicle_type,material_cost,cp_cost,meta',
    { token },
  )
  if (res.status !== 200 || !Array.isArray(res.body)) die(`catalog fetch failed (HTTP ${res.status})`)
  return res.body
}

// A legal 20-card deck: `required` first, then filler from the same faction,
// two copies each, never a summonOnly card and never more than 6 fliers.
function buildDeck(cards, faction, required) {
  const pool = cards.filter((c) => c.faction === faction && c.meta?.summonOnly !== true)
  const byName = new Map(pool.map((c) => [c.name, c]))
  const deck = {}
  let count = 0
  let fliers = 0
  const add = (card, qty) => {
    const flier = card.vehicle_type === 'plane' || card.vehicle_type === 'airship'
    if (flier && fliers + qty > 6) return false
    if (count + qty > 20) return false
    deck[card.id] = (deck[card.id] ?? 0) + qty
    count += qty
    if (flier) fliers += qty
    return true
  }
  for (const name of required) {
    const card = byName.get(name)
    if (!card) die(`${faction} deck needs "${name}" but the catalog has no such built-in`)
    if (!add(card, 2)) die(`could not fit 2x ${name} into the ${faction} deck`)
  }
  for (const card of pool) {
    if (count === 20) break
    if (deck[card.id]) continue
    add(card, Math.min(2, 20 - count))
  }
  if (count !== 20) die(`${faction} deck came to ${count} cards, not 20`)
  return deck
}

// ------------------------------------------------------------------ a game

// One staged game between the two QA accounts, with helpers bound to it. All
// the turn-shuffling a live test needs lives here so each scenario below reads
// as the card's own story rather than as bookkeeping.
async function startGame(p1, p2, spec, cards) {
  const p1Deck = buildDeck(cards, spec.p1Faction, spec.p1Required)
  const p2Deck = buildDeck(cards, spec.p2Faction, spec.p2Required)

  async function makeDeck(who, faction, deckCards) {
    const res = await rest('/decks', {
      method: 'POST', token: who.token, prefer: 'return=representation',
      body: { owner_id: who.userId, name: `wave5-smoke-${Date.now()}`, faction, cards: deckCards },
    })
    if (res.status >= 300 || !res.body?.[0]?.id) {
      die(`deck create failed for ${faction} (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`)
    }
    return res.body[0].id
  }

  const p1DeckId = await makeDeck(p1, spec.p1Faction, p1Deck)
  const p2DeckId = await makeDeck(p2, spec.p2Faction, p2Deck)

  const lobbyRes = await rest('/lobbies', {
    method: 'POST', token: p1.token, prefer: 'return=representation',
    body: {
      host_id: p1.userId, name: `wave5-smoke-${Date.now()}`, status: 'open', host_deck_id: p1DeckId,
      // All three zones water, and a big base so a stray bombardment cannot
      // end the game mid-test.
      settings: { zones: [1, 2, 3].map(() => ({ biome: 'water', baseHp: 5000 })) },
    },
  })
  if (lobbyRes.status >= 300 || !lobbyRes.body?.[0]?.id) {
    die(`lobby create failed (HTTP ${lobbyRes.status}): ${JSON.stringify(lobbyRes.body).slice(0, 300)}`)
  }
  const lobbyId = lobbyRes.body[0].id

  const joined = await fn('lobby-action', p2.token, { action: 'JOIN', lobbyId, deckId: p2DeckId })
  if (joined.status !== 200) die(`guest join failed (HTTP ${joined.status})`)
  const started = await fn('lobby-action', p1.token, { action: 'START', lobbyId })
  if (started.status !== 200) die(`START failed (HTTP ${started.status}): ${JSON.stringify(started.body).slice(0, 300)}`)

  const lobbyNow = await rest(`/lobbies?id=eq.${lobbyId}&select=game_id`, { token: p1.token })
  const gameId = lobbyNow.body?.[0]?.game_id
  if (!gameId) die('lobby has no game_id after START')

  const g = {
    gameId, lobbyId,
    async load(who = p1) {
      const res = await rest(`/games?id=eq.${gameId}&select=*`, { token: who.token })
      if (res.status !== 200 || !res.body?.[0]) die(`game fetch failed (HTTP ${res.status})`)
      return res.body[0]
    },
    async hand(who) {
      const res = await rest(
        `/game_players?game_id=eq.${gameId}&player_id=eq.${who.userId}&select=hand`, { token: who.token },
      )
      return res.body?.[0]?.hand ?? []
    },
    async act(who, action) {
      const game = await g.load(who)
      return fn('game-action', who.token, { gameId, expectedVersion: game.version, action })
    },
    async sideOf(who) {
      const game = await g.load(who)
      return game.player_a === who.userId ? 'a' : 'b'
    },
    async activeIs(who) {
      const game = await g.load(who)
      return game.active_player === who.userId
    },
    // END_TURN until it is `who`'s move.
    async passTo(who) {
      const other = who === p1 ? p2 : p1
      for (let i = 0; i < 8; i++) {
        if (await g.activeIs(who)) return
        const res = await g.act(other, { type: 'END_TURN' })
        if (res.status !== 200) die(`END_TURN failed (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`)
      }
      die('could not hand the turn over')
    },
    // Play turns until `name` is in `who`'s hand, then hand them the turn.
    async drawUntil(who, name) {
      for (let i = 0; i < 30; i++) {
        const found = (await g.hand(who)).find((c) => c.name === name)
        if (found) { await g.passTo(who); return (await g.hand(who)).find((c) => c.name === name) }
        const game = await g.load(who)
        const active = game.active_player === who.userId ? who : (who === p1 ? p2 : p1)
        const res = await g.act(active, { type: 'END_TURN' })
        if (res.status !== 200) die(`END_TURN failed (HTTP ${res.status})`)
      }
      die(`${name} never reached the hand in 30 turns`)
    },
    // Deploy the cheapest affordable ship from `who`'s hand into `zoneId`.
    async deployShip(who, zoneId) {
      await g.passTo(who)
      const game = await g.load(who)
      const side = game.player_a === who.userId ? 'a' : 'b'
      const affordable = (await g.hand(who))
        .filter((c) => c.type === 'vehicle' && c.vehicleType === 'ship' &&
          c.materialCost <= game.state.resources[side].materials && c.cpCost <= game.state.resources[side].cp)
        .sort((x, y) => x.materialCost - y.materialCost)
      for (const card of affordable) {
        const res = await g.act(who, { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId })
        if (res.status === 200) return card
      }
      return null
    },
  }
  return g
}

async function cleanUp(games, p1) {
  if (keep) return
  for (const g of games) await rest(`/lobbies?id=eq.${g.lobbyId}`, { method: 'DELETE', token: p1.token })
}

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

  await g.passTo(p1)
  const cast = await g.act(p1, {
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
    const decided = await g.act(p1, { type: 'DECIDE_BATTLE_REPORT', approve: true })
    step('the summon evaporated on approval, leaving nothing behind', decided.status === 200 &&
      !(await g.load(p1)).state.destroyed[hSide].some((c) => c.name === doomed.name), '')
  }

  // ---- Sub Killer: remove a DWG airship, and leave a GT block ------------
  const logger = await g.drawUntil(p1, 'Loggerhead')
  await g.passTo(p1)
  const flown = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: logger.instanceId, zoneId: 2 })
  step('host deployed a Loggerhead into zone 2', flown.status === 200,
    flown.status === 200 ? '' : JSON.stringify(flown.body).slice(0, 300))

  const killer = await g.drawUntil(p2, 'Sub Killer')
  await g.passTo(p2)
  const killed = await g.act(p2, {
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

  // ---- Sabotage: FRAGILE now, a draw at the guest's own END_TURN ---------
  const sabotage = await g.drawUntil(p2, 'Sabotage')
  await g.passTo(p2)
  game = await g.load(p2)
  const victim = game.state.zones.flatMap((z) => z.cards[hSide])[0]
  if (!victim) die('no host hull left to sabotage')
  const sabotaged = await g.act(p2, {
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
  const blockBefore = ((await g.load(p2)).state.zoneEffects ?? []).length
  const ended = await g.act(p2, { type: 'END_TURN' })
  if (ended.status !== 200) die(`END_TURN failed (HTTP ${ended.status})`)
  game = await g.load(p2)
  step('the guest drew on their OWN end of turn (the watch paid out)',
    (await g.hand(p2)).length === handBefore + 1,
    `hand ${handBefore} -> ${(await g.hand(p2)).length}`)
  step('the rest-of-turn GT block expired in the same pass',
    (game.state.zoneEffects ?? []).length === blockBefore - 1 &&
    !(game.state.zoneEffects ?? []).some((e) => e.effect === 'subKillerEffect'),
    `${blockBefore} -> ${(game.state.zoneEffects ?? []).length} riders`)

  // ---- Ongoing Attrition: strike at the host's own fleet-attack lock -----
  const attrition = await g.drawUntil(p1, 'Ongoing Attrition')
  // Zone 3 is untouched, so the host can out-number there cleanly.
  await g.deployShip(p1, 3)
  await g.deployShip(p1, 3)
  await g.passTo(p2)
  const bait = await g.deployShip(p2, 3)
  if (!bait) die('guest could not deploy bait into zone 3')
  await g.passTo(p1)
  const claimed = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: attrition.instanceId, zoneId: 3 })
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

  await g.passTo(p1)
  const set = await g.act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: ambush.instanceId, zoneId: 1 })
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

await cleanUp(games, p1)
const passed = results.filter((r) => r.ok).length
console.log(`\n  ${passed}/${results.length} steps passed`)
for (const g of games) console.log(`  game ${g.gameId}${keep ? `  (kept — open it at /game/${g.gameId})` : ''}`)
console.log('')
