#!/usr/bin/env node
// Shared plumbing for the live smoke harnesses.
//
// Extracted from scripts/smoke-wave5.mjs in wave 6. That script was described
// in its own handoff as "a reusable harness — point its `required` deck lists
// at your cards", and it very nearly was: startGame already takes a
// { p1Faction, p1Required, p2Faction, p2Required } spec. What it was NOT was
// importable — it exported nothing and ran wave 5's own scenarios at top
// level, so importing it ran wave 5's whole suite as a side effect.
//
// This module is that plumbing with the scenarios left behind. It knows three
// things a fresh harness would have to relearn, each of which cost wave 5 a
// re-run:
//
//   * ATTACK_ENEMY_FLEET does not always lock the battle. A Stealthy or
//     omissible defender raises the response window instead, and the lock —
//     with it DP2's whole dispatch — happens on RESPOND_TO_ATTACK. Which
//     branch you get depends on the deal, so a harness that skips it passes
//     or fails by luck. Use lockIfPending().
//   * Staging spans turns. Income is SET to floor(turnNumber) * 75k at each
//     turn start, not accumulated, so two hulls cannot be bought out of one
//     turn's budget. attempt() and deployShip() both wait it out.
//   * A live test whose result depends on the shuffle is not a test yet.
//
// Credentials come from scripts/qa-accounts.local (gitignored). Passwords are
// read into memory, sent only to /auth/v1/token, and never printed.


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
    // keywords added in wave 7: without it every c.keywords is undefined, and a
    // check like "no card seeded a null keyword" passes VACUOUSLY — wave 6's
    // harness bug #2, repeated.
    '/cards?is_built_in=eq.true&select=id,name,faction,type,vehicle_type,material_cost,cp_cost,keywords,meta',
    { token },
  )
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
      body: { owner_id: who.userId, name: `${spec.label ?? 'smoke'}-${Date.now()}`, faction, cards: deckCards },
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
      host_id: p1.userId, name: `${spec.label ?? 'smoke'}-${Date.now()}`, status: 'open', host_deck_id: p1DeckId,
      // All three zones water, and a big base so a stray bombardment cannot
      // end the game mid-test.
      settings: {
        zones: [1, 2, 3].map(() => ({ biome: 'water', baseHp: 5000 })),
        // Per-lobby income (shared/lobbySettings.ts), frozen into the game at
        // START. Two reasons a harness wants it:
        //   * a card costing 630k is otherwise unreachable before turn 9, and
        //     every turn is a round trip;
        //   * a card whose effect keys off a materials THRESHOLD needs the
        //     income tuned so both sides of that threshold are reachable —
        //     which is the opposite need, and why this is a per-spec knob
        //     rather than a constant. Omit it for the 75k default.
        ...(spec.materialsPerTurn ? { materialsPerTurn: spec.materialsPerTurn } : {}),
      },
    },
  })
  if (lobbyRes.status >= 300 || !lobbyRes.body?.[0]?.id) {
    die(`lobby create failed (HTTP ${lobbyRes.status}): ${JSON.stringify(lobbyRes.body).slice(0, 300)}`)
  }
  const lobbyId = lobbyRes.body[0].id

  const joined = await fn('lobby-action', p2.token, { action: 'JOIN', lobbyId, deckId: p2DeckId })
  if (joined.status !== 200) die(`guest join failed (HTTP ${joined.status})`)

  // START is ready-gated as of the lobby redesign: both seats must carry a
  // deck AND a ready check. Every harness that calls startGame goes through
  // here, so the gate is satisfied once, in one place.
  for (const [who, label] of [[p1, 'host'], [p2, 'guest']]) {
    const r = await fn('lobby-action', who.token, { action: 'SET_READY', lobbyId, ready: true })
    if (r.status !== 200) die(`${label} SET_READY failed (HTTP ${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`)
  }

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
    // ATTACK_ENEMY_FLEET does not always lock the battle: a Stealthy or
    // omissible defender raises the response window instead, and the lock —
    // with it DP2's whole dispatch — happens on RESPOND_TO_ATTACK. Which
    // branch you get depends on which hulls the deal handed out (Abactor is
    // Stealthy, Corsair is not), so a harness that skips this passes or fails
    // by luck. The defender opts nobody out, so every listed hull fights.
    async lockIfPending(defender) {
      const game = await g.load(defender)
      if (!game.state.awaitingResponse) return
      const res = await g.act(defender, { type: 'RESPOND_TO_ATTACK', optOutIds: [] })
      if (res.status !== 200) die(`RESPOND_TO_ATTACK failed (HTTP ${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`)
    },
    // Run `action` on `who`'s turn, ending turns and retrying while it fails
    // for want of materials — income is SET to floor(turnNumber) * 75k each
    // turn, so waiting is how a player affords anything. Any OTHER failure is
    // returned immediately so the caller's step reports the real error rather
    // than a timeout.
    async attempt(who, action, rounds = 8) {
      let last
      for (let i = 0; i < rounds; i++) {
        await g.passTo(who)
        last = await g.act(who, action)
        if (last.status === 200) return last
        if (!JSON.stringify(last.body ?? '').includes('afford')) return last
        const res = await g.act(who, { type: 'END_TURN' })
        if (res.status !== 200) die(`END_TURN failed while waiting for materials (HTTP ${res.status})`)
      }
      return last
    },
    // End turns until `predicate(materials)` holds for `who`, returning the
    // figure it stopped on (or null if it never held).
    //
    // Income is SET to floor(turnNumber) * materialsPerTurn at each turn
    // start, not accumulated, so a card whose effect keys off a materials
    // THRESHOLD needs the harness to wait for a turn on the right side of it.
    // Spending inside a turn moves the figure the other way, which is the trap
    // this exists for: wave 6's first run tested Paladin's "under 240k" clause
    // at 250k, because the step before it had spent down from 450k. The engine
    // was right and the harness was wrong, and it took four failing steps to
    // say so.
    async waitForMaterials(who, predicate, rounds = 12) {
      for (let i = 0; i < rounds; i++) {
        await g.passTo(who)
        const game = await g.load(who)
        const side = game.player_a === who.userId ? 'a' : 'b'
        const materials = game.state.resources[side].materials
        if (predicate(materials)) return materials
        const res = await g.act(who, { type: 'END_TURN' })
        if (res.status !== 200) die(`END_TURN failed while waiting for materials (HTTP ${res.status})`)
      }
      return null
    },
    // Spend `who`'s materials down into [floor, ceiling) by deploying hulls
    // into `zoneId`, largest-first and never dropping below `floor`.
    //
    // waitForMaterials above is the wrong tool for a LOW threshold and this is
    // the right one, for a reason worth stating: income is SET to
    // floor(turnNumber) * materialsPerTurn at each turn start, so the figure
    // only ever RISES between turns. A card whose condition reads "while you
    // have LESS than 240k" is therefore unreachable by waiting the moment the
    // turn counter passes it — and drawUntil, which burns turns to find the
    // card, is what pushes it past. Wave 6's second run failed exactly here.
    //
    // Costs are filtered on printed materialCost while the charge is
    // effectiveCostInGame, so a Half-Cost hull spends LESS than budgeted. That
    // errs upward, away from the floor, which is the safe direction.
    async spendInto(who, { floor, ceiling, zoneId, exclude = [] }, rounds = 15) {
      await g.passTo(who)
      for (let i = 0; i < rounds; i++) {
        const game = await g.load(who)
        const side = game.player_a === who.userId ? 'a' : 'b'
        const have = game.state.resources[side].materials
        if (have >= floor && have < ceiling) return have
        if (have < floor) return null
        const options = (await g.hand(who))
          .filter((c) => c.type === 'vehicle' && c.vehicleType === 'ship' &&
            !exclude.includes(c.name) && c.materialCost > 0 && have - c.materialCost >= floor)
          .sort((x, y) => y.materialCost - x.materialCost)
        let spent = false
        for (const card of options) {
          const res = await g.act(who, { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId })
          if (res.status === 200) { spent = true; break }
        }
        if (!spent) return null
      }
      return null
    },
    // Deploy the cheapest affordable ship from `who`'s hand into `zoneId`.
    //
    // Spans turns on purpose. Income is SET to floor(turnNumber) * 75k at each
    // turn start, so a player who cannot afford a hull now can afford one two
    // turns later — and a caller staging three hulls would otherwise blow the
    // first turn's budget on the first one and then fail. Each pass also draws
    // a card, so an empty hand fills up too.
    async deployShip(who, zoneId, rounds = 8) {
      for (let i = 0; i < rounds; i++) {
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
        const res = await g.act(who, { type: 'END_TURN' })
        if (res.status !== 200) die(`END_TURN failed while staging (HTTP ${res.status})`)
      }
      return null
    },
  }
  return g
}

async function cleanUp(games = [], p1) {
  if (keep) return
  for (const g of games) await rest(`/lobbies?id=eq.${g.lobbyId}`, { method: 'DELETE', token: p1.token })
}

// ------------------------------------------------------------------ report

// The tail both harnesses share: totals, then the game ids so a kept run can
// be opened in the browser. Sets a non-zero exit code if any step failed —
// step() already does, but a run that dies before reaching here should fail
// too, and this is the last thing to touch process.exitCode.
async function report(games = [], p1) {
  await cleanUp(games, p1)
  const passed = results.filter((r) => r.ok).length
  console.log(`\n  ${passed}/${results.length} steps passed`)
  for (const g of games) {
    console.log(`  game ${g.gameId}${keep ? `  (kept — open it at /game/${g.gameId})` : ''}`)
  }
  console.log('')
  if (passed !== results.length) process.exitCode = 1
  return { passed, total: results.length }
}

export {
  keep, die, step, results,
  api, rest, fn, signIn,
  builtIns, buildDeck,
  startGame, cleanUp, report,
}
