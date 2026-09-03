#!/usr/bin/env node
// Live smoke test for the redesigned lobby flow against the REAL backend.
// Plumbing lives in ./smoke-lib.mjs; this file is scenarios only.
//
// What it proves that no unit test can: the four new lobby-action ops and the
// ready-gated START lock actually behave that way through Postgres and RLS.
// There is no local Supabase stack, so this is the only place the ops run.
//
// Usage:  node scripts/smoke-lobby.mjs [--keep]
//
// Credentials come from scripts/qa-accounts.local (gitignored).

import { step, rest, fn, signIn, builtIns, buildDeck, report, keep } from './smoke-lib.mjs'

const WATER = [1, 2, 3].map(() => ({ biome: 'water', baseHp: 5000 }))

async function main() {
  const p1 = await signIn('P1')
  const p2 = await signIn('P2')
  const cards = await builtIns(p1.token)

  async function makeDeck(who, faction) {
    const res = await rest('/decks', {
      method: 'POST', token: who.token, prefer: 'return=representation',
      body: {
        owner_id: who.userId, name: `lobby-smoke-${Date.now()}`, faction,
        cards: buildDeck(cards, faction, []),
      },
    })
    return res.body[0].id
  }
  const hostDeck = await makeDeck(p1, 'DWG')
  const guestDeck = await makeDeck(p2, 'DWG')

  // A deckless lobby is the whole point of R-2 — it must be insertable now.
  const created = await rest('/lobbies', {
    method: 'POST', token: p1.token, prefer: 'return=representation',
    body: { host_id: p1.userId, name: `lobby-smoke-${Date.now()}`, status: 'open', settings: { zones: WATER } },
  })
  step('creates a lobby with no host deck', created.status < 300 && !!created.body?.[0]?.id,
    `HTTP ${created.status}`)
  const lobbyId = created.body?.[0]?.id
  if (!lobbyId) return

  const load = async () => (await rest(`/lobbies?id=eq.${lobbyId}&select=*`, { token: p1.token })).body?.[0]

  // Readying without a deck must fail — this is the precondition SET_READY
  // enforces so START never has to.
  const earlyReady = await fn('lobby-action', p1.token, { action: 'SET_READY', lobbyId, ready: true })
  step('refuses ready before a deck is picked', earlyReady.status === 409, `HTTP ${earlyReady.status}`)

  const setHostDeck = await fn('lobby-action', p1.token, { action: 'SET_DECK', lobbyId, deckId: hostDeck })
  step('host sets a deck from inside the lobby', setHostDeck.status === 200, `HTTP ${setHostDeck.status}`)

  const joined = await fn('lobby-action', p2.token, { action: 'JOIN', lobbyId })
  step('guest joins without naming a deck', joined.status === 200, `HTTP ${joined.status}`)

  const guestDeckSet = await fn('lobby-action', p2.token, { action: 'SET_DECK', lobbyId, deckId: guestDeck })
  step('guest sets a deck from inside the lobby', guestDeckSet.status === 200, `HTTP ${guestDeckSet.status}`)

  // R-1 through the denormalized column: the guest can see the host's FACTION
  // without being able to read the host's deck at all.
  const seen = (await rest(`/lobbies?id=eq.${lobbyId}&select=host_faction,guest_faction`, { token: p2.token })).body?.[0]
  step('guest reads the host faction off the lobby row', seen?.host_faction === 'DWG', String(seen?.host_faction))

  // The property that denormalization exists to preserve. If this ever starts
  // returning a row, the opponent's entire decklist is readable and the
  // "faction yes, deck name no" rule in spec §5.3 is gone.
  const peek = await rest(`/decks?id=eq.${hostDeck}&select=id,name,cards`, { token: p2.token })
  step('guest CANNOT read the host deck itself',
    Array.isArray(peek.body) && peek.body.length === 0, `${peek.body?.length ?? '?'} rows`)

  // A guest must not be able to edit the battlefield.
  const guestSettings = await fn('lobby-action', p2.token, {
    action: 'UPDATE_SETTINGS', lobbyId, settings: { zones: WATER },
  })
  step('guest cannot change settings', guestSettings.status === 409, `HTTP ${guestSettings.status}`)

  await fn('lobby-action', p1.token, { action: 'SET_READY', lobbyId, ready: true })
  await fn('lobby-action', p2.token, { action: 'SET_READY', lobbyId, ready: true })
  const bothReady = await load()
  step('both seats read as ready', bothReady.host_ready === true && bothReady.guest_ready === true)

  // R-8, the consent invariant: a settings change must drop the guest's ready
  // flag and leave the host's alone.
  const changed = await fn('lobby-action', p1.token, {
    action: 'UPDATE_SETTINGS', lobbyId,
    settings: { zones: [{ biome: 'land', baseHp: 5000 }, { biome: 'beach', baseHp: 5000 }, { biome: 'water', baseHp: 5000 }] },
  })
  step('host changes settings in the lobby', changed.status === 200, `HTTP ${changed.status}`)
  const afterChange = await load()
  step('settings change clears ONLY the guest ready flag',
    afterChange.guest_ready === false && afterChange.host_ready === true)

  const blocked = await fn('lobby-action', p1.token, { action: 'START', lobbyId })
  step('START is refused while the guest is unready', blocked.status === 409, `HTTP ${blocked.status}`)

  // Changing your own deck drops your own flag, not the other player's.
  await fn('lobby-action', p2.token, { action: 'SET_READY', lobbyId, ready: true })
  await fn('lobby-action', p2.token, { action: 'SET_DECK', lobbyId, deckId: guestDeck })
  const afterDeckSwap = await load()
  step('changing your deck clears your own ready flag', afterDeckSwap.guest_ready === false)

  // A guest cannot be kicked by anyone but the host.
  const badKick = await fn('lobby-action', p2.token, { action: 'KICK', lobbyId })
  step('a guest cannot kick', badKick.status === 409, `HTTP ${badKick.status}`)

  const kicked = await fn('lobby-action', p1.token, { action: 'KICK', lobbyId })
  step('host kicks the guest', kicked.status === 200, `HTTP ${kicked.status}`)
  const afterKick = await load()
  step('kick frees the seat entirely',
    afterKick.guest_id === null && afterKick.guest_deck_id === null &&
    afterKick.guest_faction === null && afterKick.guest_ready === false)

  // Rejoin and run the flow to completion.
  await fn('lobby-action', p2.token, { action: 'JOIN', lobbyId })
  await fn('lobby-action', p2.token, { action: 'SET_DECK', lobbyId, deckId: guestDeck })
  await fn('lobby-action', p2.token, { action: 'SET_READY', lobbyId, ready: true })
  const started = await fn('lobby-action', p1.token, { action: 'START', lobbyId })
  step('START succeeds once both seats are decked and ready',
    started.status === 200 && !!started.body?.gameId, `HTTP ${started.status}`)

  const finished = await load()
  step('lobby closes and carries the game id',
    finished.status === 'closed' && finished.game_id === started.body?.gameId)

  const game = await rest(`/games?id=eq.${started.body?.gameId}&select=id,player_a,player_b`, { token: p2.token })
  step('the guest can read the game they were started into', game.body?.[0]?.id === started.body?.gameId)

  if (!keep) await rest(`/lobbies?id=eq.${lobbyId}`, { method: 'DELETE', token: p1.token })
}

await main()
report()
