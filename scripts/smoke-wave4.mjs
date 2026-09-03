#!/usr/bin/env node
// Live smoke test for effect-coverage wave 4, against the REAL deployed
// backend. This exists because the wave's riskiest surface has no unit test
// and `tsc` does not read it: `game-action`'s catalog probe. Its four sources
// decide whether an effect that mints from the catalog gets a catalog at all,
// and a regression there is a card that silently does nothing in production
// while every check stays green.
//
// What it proves, end to end through the deployed function:
//
//   source 1  the card in the caller's hand      — playing DWG Waters
//   source 4  state.zoneEffects (NEW in wave 4)  — its clause-2 offer, which
//             lists catalog cards for a spent ability that is in no hand,
//             on no field, and not the pending card
//   source 3  state.pendingEffect.card           — resolving that offer, which
//             mints the chosen hull
//
// It also exercises DP2's lock dispatch, joinBattle, and the both-freezes-set
// state (pendingEffect owed to the defender while activeBattle stands).
//
// Usage:  node scripts/smoke-wave4.mjs [--keep]
//   --keep   leave the game and lobby behind for browser inspection
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

function die(msg) { console.error(`\n  ✗ ${msg}\n`); process.exitCode = 1; throw new Error(msg) }
if (!BASE || !ANON) die('frontend/.env.local must define VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY')
if (!accounts.P1_EMAIL || !accounts.P2_EMAIL) die('scripts/qa-accounts.local must define P1_* and P2_*')

// ------------------------------------------------------------------- steps

const results = []
function step(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
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
  const res = await rest('/cards?is_built_in=eq.true&select=id,name,faction,type,vehicle_type,material_cost,meta', { token })
  if (res.status !== 200 || !Array.isArray(res.body)) die(`catalog fetch failed (HTTP ${res.status})`)
  return res.body
}

// A legal 20-card deck: `required` first, then filler from the same faction,
// two copies each, never a summonOnly or retired card and never more than 6
// fliers.
function buildDeck(cards, faction, required) {
  const pool = cards.filter((c) => (
    c.faction === faction && c.meta?.summonOnly !== true && c.meta?.retired !== true
  ))
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
    if (!add(card, 2)) die(`could not fit 2× ${name} into the ${faction} deck`)
  }
  for (const card of pool) {
    if (count === 20) break
    if (deck[card.id]) continue
    add(card, Math.min(2, 20 - count))
  }
  if (count !== 20) die(`${faction} deck came to ${count} cards, not 20`)
  return deck
}

// --------------------------------------------------------------------- run

console.log('\n  Wave 4 live smoke test — real backend, real edge functions\n')

const p1 = await signIn('P1')
const p2 = await signIn('P2')
step('signed in both QA accounts', true, `${p1.email} / ${p2.email}`)

const cards = await builtIns(p1.token)
step('fetched the built-in catalog', cards.length > 100, `${cards.length} cards`)

// P1 is DWG: DWG Waters is the card under test, Corsair/Marauder are the guest
// pool its clause 2 offers, and Abactor is an ordinary hull to be attacked.
const p1Deck = buildDeck(cards, 'DWG', ['DWG Waters', 'Abactor'])
// P2 is SS: Catshark is a DP2 lock trigger, and any ship can do the attacking.
const p2Deck = buildDeck(cards, 'SS', ['Catshark'])

async function makeDeck(who, faction, deckCards) {
  const res = await rest('/decks', {
    method: 'POST', token: who.token, prefer: 'return=representation',
    body: { owner_id: who.userId, name: `wave4-smoke-${Date.now()}`, faction, cards: deckCards },
  })
  if (res.status >= 300 || !res.body?.[0]?.id) die(`deck create failed for ${faction} (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`)
  return res.body[0].id
}

const p1DeckId = await makeDeck(p1, 'DWG', p1Deck)
const p2DeckId = await makeDeck(p2, 'SS', p2Deck)
step('built two valid 20-card decks', true, 'DWG (host) vs SS (guest)')

const lobbyRes = await rest('/lobbies', {
  method: 'POST', token: p1.token, prefer: 'return=representation',
  body: {
    host_id: p1.userId, name: `wave4-smoke-${Date.now()}`, status: 'open', host_deck_id: p1DeckId,
    // All three zones water: DWG and SS are both ship factions, and biome
    // legality would otherwise refuse the hulls this test needs to place.
    settings: { zones: [1, 2, 3].map(() => ({ biome: 'water', baseHp: 1000 })) },
  },
})
if (lobbyRes.status >= 300 || !lobbyRes.body?.[0]?.id) {
  die(`lobby create failed (HTTP ${lobbyRes.status}): ${JSON.stringify(lobbyRes.body).slice(0, 300)}`)
}
const lobbyId = lobbyRes.body[0].id

const joined = await fn('lobby-action', p2.token, { action: 'JOIN', lobbyId, deckId: p2DeckId })
step('guest joined the lobby', joined.status === 200, `HTTP ${joined.status}`)

// START is ready-gated as of the lobby redesign. This script has its own
// inline lobby setup rather than smoke-lib's startGame, so it needs its own
// copy of the ready calls.
for (const who of [p1, p2]) {
  const r = await fn('lobby-action', who.token, { action: 'SET_READY', lobbyId, ready: true })
  if (r.status !== 200) die(`SET_READY failed (HTTP ${r.status})`)
}

const started = await fn('lobby-action', p1.token, { action: 'START', lobbyId })
step('host started the game', started.status === 200, `HTTP ${started.status}`)
if (started.status !== 200) die(JSON.stringify(started.body).slice(0, 400))

const lobbyNow = await rest(`/lobbies?id=eq.${lobbyId}&select=game_id`, { token: p1.token })
const gameId = lobbyNow.body?.[0]?.game_id
if (!gameId) die('lobby has no game_id after START')

// ------------------------------------------------------------ game helpers

async function loadGame(who) {
  const res = await rest(`/games?id=eq.${gameId}&select=*`, { token: who.token })
  if (res.status !== 200 || !res.body?.[0]) die(`game fetch failed (HTTP ${res.status})`)
  return res.body[0]
}
async function loadHand(who) {
  const res = await rest(`/game_players?game_id=eq.${gameId}&player_id=eq.${who.userId}&select=hand`, { token: who.token })
  return res.body?.[0]?.hand ?? []
}
async function act(who, action) {
  const game = await loadGame(who)
  return { ...(await fn('game-action', who.token, { gameId, expectedVersion: game.version, action })), before: game }
}

// The deal is random, so play turns until DWG Waters reaches the host's hand.
// Each END_TURN draws one card for the incoming side.
let watersCard = null
let turns = 0
while (turns < 24) {
  const hand = await loadHand(p1)
  watersCard = hand.find((c) => c.name === 'DWG Waters') ?? null
  if (watersCard) break
  const game = await loadGame(p1)
  const active = game.active_player === p1.userId ? p1 : p2
  const ended = await act(active, { type: 'END_TURN' })
  if (ended.status !== 200) die(`END_TURN failed (HTTP ${ended.status}): ${JSON.stringify(ended.body).slice(0, 300)}`)
  turns++
}
step('DWG Waters reached the host hand', watersCard !== null, `after ${turns} turn(s)`)
if (!watersCard) die('never drew DWG Waters in 24 turns')

// Make sure it is the host's turn before playing.
let game = await loadGame(p1)
while (game.active_player !== p1.userId) {
  const ended = await act(p2, { type: 'END_TURN' })
  if (ended.status !== 200) die(`END_TURN failed (HTTP ${ended.status})`)
  game = await loadGame(p1)
}

// ---- probe source 1: the card being played is in the caller's own hand ----
const claim = await act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: watersCard.instanceId, zoneId: 1 })
step('probe source 1 — DWG Waters claims zone 1', claim.status === 200,
  claim.status === 200 ? '' : JSON.stringify(claim.body).slice(0, 300))
if (claim.status !== 200) die('claim failed')

game = await loadGame(p1)
const zoneEffects = game.state.zoneEffects ?? []
step('the claim persisted as a zoneEffect', zoneEffects.some((e) => e.effect === 'dwgWatersEffect' && e.zoneId === 1),
  JSON.stringify(zoneEffects))

// The host needs a hull in zone 1 for the guest to attack.
let hostHull = null
for (let i = 0; i < 24 && !hostHull; i++) {
  const hand = await loadHand(p1)
  const g = await loadGame(p1)
  if (g.active_player === p1.userId) {
    const playable = hand.find((c) => c.type === 'vehicle' && c.vehicleType === 'ship' &&
      c.materialCost <= g.state.resources[g.player_a === p1.userId ? 'a' : 'b'].materials)
    if (playable) {
      const res = await act(p1, { type: 'PLAY_CARD_TO_ZONE', instanceId: playable.instanceId, zoneId: 1 })
      if (res.status === 200) { hostHull = playable; break }
    }
  }
  const active = (await loadGame(p1)).active_player === p1.userId ? p1 : p2
  await act(active, { type: 'END_TURN' })
}
step('host has a hull in the claimed zone', hostHull !== null, hostHull?.name ?? '')

// And the guest needs one to attack with, deployed a turn earlier so it may act.
let guestHull = null
for (let i = 0; i < 24 && !guestHull; i++) {
  const g = await loadGame(p2)
  if (g.active_player === p2.userId) {
    const hand = await loadHand(p2)
    const side = g.player_a === p2.userId ? 'a' : 'b'
    const playable = hand.find((c) => c.type === 'vehicle' && c.vehicleType === 'ship' &&
      c.materialCost <= g.state.resources[side].materials)
    if (playable) {
      const res = await act(p2, { type: 'PLAY_CARD_TO_ZONE', instanceId: playable.instanceId, zoneId: 1 })
      if (res.status === 200) { guestHull = playable; break }
    }
  }
  const active = (await loadGame(p2)).active_player === p2.userId ? p2 : p1
  await act(active, { type: 'END_TURN' })
}
step('guest has a hull in the claimed zone', guestHull !== null, guestHull?.name ?? '')
if (!hostHull || !guestHull) die('could not stage both hulls')

// A vehicle cannot attack the turn it deploys — pass until the guest is active
// again with its hull no longer fresh.
game = await loadGame(p2)
while (game.active_player !== p2.userId) {
  await act(p1, { type: 'END_TURN' })
  game = await loadGame(p2)
}

// -------- probe source 4: the rider fires for a card that is nowhere --------
const guestSide = game.player_a === p2.userId ? 'a' : 'b'
const hostSide = guestSide === 'a' ? 'b' : 'a'
const zone1 = game.state.zones.find((z) => z.id === 1)
const attackers = zone1.cards[guestSide].map((c) => c.instanceId)
const targets = zone1.cards[hostSide].map((c) => c.instanceId)
const attack = await act(p2, { type: 'ATTACK_ENEMY_FLEET', zoneId: 1, attackerIds: attackers, targetIds: targets })
step('guest declared a fleet attack into the claimed zone', attack.status === 200,
  attack.status === 200 ? '' : JSON.stringify(attack.body).slice(0, 300))

game = await loadGame(p1)
const pending = game.state.pendingEffect
const offered = (pending?.options ?? []).map((o) => o.id).sort()
step('probe source 4 — the spent ability offered its catalog guests',
  pending !== null && offered.length > 0 && offered.every((n) => ['Corsair', 'Marauder'].includes(n)),
  `pendingEffect=${pending ? `${pending.card.name} owed to ${pending.side}` : 'null'} options=${JSON.stringify(offered)}`)
step('both freezes are set at once (decision 19)',
  game.state.pendingEffect !== null && game.state.activeBattle !== null,
  `pendingEffect=${game.state.pendingEffect !== null} activeBattle=${game.state.activeBattle !== null}`)

// ---- probe source 3: pendingEffect.card, minting the chosen hull ----
if (pending) {
  const pick = offered[0]
  const resolved = await act(p1, { type: 'RESOLVE_PENDING_EFFECT', choiceId: pick })
  step(`probe source 3 — resolving the offer minted a ${pick}`, resolved.status === 200,
    resolved.status === 200 ? '' : JSON.stringify(resolved.body).slice(0, 300))
  game = await loadGame(p1)
  const battle = game.state.activeBattle
  const summonNames = (battle?.summons ?? []).map((s) => s.name)
  step('the guest hull joined the battle as a summon',
    summonNames.includes(pick) && battle.defenderIds.length >= 2,
    `summons=${JSON.stringify(summonNames)} defenders=${battle?.defenderIds.length}`)
  step('the battle is still reportable after the choice',
    game.state.activeBattle !== null && game.state.pendingEffect === null, '')
}

// ------------------------------------------------------------------ report

if (!keep) {
  await rest(`/lobbies?id=eq.${lobbyId}`, { method: 'DELETE', token: p1.token })
}
const passed = results.filter((r) => r.ok).length
console.log(`\n  ${passed}/${results.length} steps passed`)
console.log(`  game ${gameId}${keep ? '  (kept — open it at /game/' + gameId + ')' : ''}\n`)
