#!/usr/bin/env node
// Post-deploy smoke for the practice-game bot (2026-09-16 AI opponent spec §9),
// driven through the REAL lobby-action and game-action. Signs in P1 only —
// PracticeAI is the other seat. Needs the bootstrap in docs/claude/supabase.md.
//
//   node scripts/smoke-practice.mjs            # cleans up the lobby after
//   node scripts/smoke-practice.mjs --keep     # leaves the game to open in the browser
import { buildDeck, builtIns, fn, report, rest, signIn, step } from './smoke-lib.mjs'

const BOT_FACTION = 'OW'
const p1 = await signIn('P1')
const cards = await builtIns(p1.token)

const deckRes = await rest('/decks', {
  method: 'POST', token: p1.token, prefer: 'return=representation',
  // Corsair and Marauder (30k/55k) are required so the deck holds turn-one
  // ships; the first live run drew a hand without one and the deploy below
  // had nothing to play.
  body: { owner_id: p1.userId, name: `practice-${Date.now()}`, faction: 'DWG', cards: buildDeck(cards, 'DWG', ['Corsair', 'Marauder']) },
})
const deckId = deckRes.body?.[0]?.id
step('P1 deck created', !!deckId, `HTTP ${deckRes.status}`)

const lobbyRes = await rest('/lobbies', {
  method: 'POST', token: p1.token, prefer: 'return=representation',
  body: {
    host_id: p1.userId, name: `practice-${Date.now()}`, status: 'open', host_deck_id: deckId,
    settings: { zones: [1, 2, 3].map(() => ({ biome: 'water', baseHp: 5000 })) },
  },
})
const lobbyId = lobbyRes.body?.[0]?.id
step('lobby created', !!lobbyId, `HTTP ${lobbyRes.status}`)

const added = await fn('lobby-action', p1.token, { action: 'ADD_BOT', lobbyId, faction: BOT_FACTION })
step('ADD_BOT seats PracticeAI', added.status === 200 && !!added.body?.lobby?.guest_id,
  `HTTP ${added.status} ${JSON.stringify(added.body).slice(0, 160)}`)
step('bot seat is ready with its faction', added.body?.lobby?.guest_ready === true && added.body?.lobby?.guest_faction === BOT_FACTION,
  `ready=${added.body?.lobby?.guest_ready} faction=${added.body?.lobby?.guest_faction}`)

const again = await fn('lobby-action', p1.token, { action: 'ADD_BOT', lobbyId, faction: BOT_FACTION })
step('a second ADD_BOT is refused (seat taken)', again.status === 409, `HTTP ${again.status}`)

const ready = await fn('lobby-action', p1.token, { action: 'SET_READY', lobbyId, ready: true })
step('host ready', ready.status === 200, `HTTP ${ready.status}`)
const started = await fn('lobby-action', p1.token, { action: 'START', lobbyId })
step('START', started.status === 200, `HTTP ${started.status} ${JSON.stringify(started.body).slice(0, 160)}`)
const gameId = started.body?.gameId
const load = async () => (await rest(`/games?id=eq.${gameId}&select=*`, { token: p1.token })).body?.[0]
const act = async (action) => {
  const g = await load()
  return fn('game-action', p1.token, { gameId, expectedVersion: g.version, action })
}

let game = await load()
step('game row exists with settings.bot', !!game && game.settings?.bot?.side === 'b', JSON.stringify(game?.settings?.bot))
step('it is P1’s move (a bot-first opening turn already resolved inside START)',
  game?.active_player === p1.userId, `turn ${game?.turn_number}, log ${game?.state?.log?.length} lines`)

// Give the bot something to fight: P1's cheapest affordable ship into zone 1
// on the first round. The bot attacks once its force there is at least as
// costly, which the OW list's 50k hulls reach within a couple of turns.
const hand = (await rest(`/game_players?game_id=eq.${gameId}&player_id=eq.${p1.userId}&select=hand`, { token: p1.token })).body?.[0]?.hand ?? []
const mySide = game.player_a === p1.userId ? 'a' : 'b'
const ship = hand
  .filter((c) => c.type === 'vehicle' && c.vehicleType === 'ship' && c.materialCost <= game.state.resources[mySide].materials)
  .sort((x, y) => x.materialCost - y.materialCost)[0]
// The deploy is a nudge, not a requirement: the rounds below prove the bot's
// reply either way, so a five-card hand that holds no cheap ship (still
// possible with four in the deck) is reported and skipped rather than failed.
if (ship) {
  const deployed = await act({ type: 'PLAY_CARD_TO_ZONE', instanceId: ship.instanceId, zoneId: 1 })
  step('P1 deploys a ship into zone 1', deployed.status === 200, `${ship.name} (HTTP ${deployed.status})`)
} else {
  console.log('  SKIP  P1 deploys a ship into zone 1 — no affordable ship in the opening hand')
}

for (let round = 1; round <= 3; round++) {
  const before = await load()
  const r = await act({ type: 'END_TURN' })
  const after = await load()
  const botMoved = after.state.log.length > before.state.log.length + 1
  // Either the bot finished its turn (P1 active again) or it declared a
  // fleet attack and is waiting on P1's report (frozen, bot still active).
  const botIdle = after.active_player === p1.userId || after.state.activeBattle !== null
  step(`round ${round}: END_TURN returns with the bot's reply resolved`,
    r.status === 200 && botIdle && botMoved,
    `HTTP ${r.status}, turn ${after.turn_number}, +${after.state.log.length - before.state.log.length} log lines${after.state.activeBattle ? ', battle declared' : ''}`)
  if (after.state.activeBattle) {
    // The bot declared a fleet attack: report it (all survive) and expect the
    // bot to approve in the same request and finish its turn.
    const ids = [...after.state.activeBattle.attackerIds, ...after.state.activeBattle.defenderIds,
      ...after.state.activeBattle.summons.map((s) => s.instanceId)]
    const results = Object.fromEntries(ids.map((id) => [id, 100]))
    const rep = await act({ type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] })
    const resolved = await load()
    step(`round ${round}: the bot approves the report and the game unfreezes`,
      rep.status === 200 && resolved.state.pendingReport === null && resolved.state.activeBattle === null,
      `HTTP ${rep.status}, pendingReport=${resolved.state.pendingReport ? 'set' : 'null'}, activeBattle=${resolved.state.activeBattle ? 'set' : 'null'}`)
  }
}

// LLM PracticeAI (spec §10.3): the bot's table-talk is a public log line, and
// each model call is a bot_decisions row. The rows are service-role only, so
// they are read through the Management API with SUPABASE_ACCESS_TOKEN, the
// way scripts/verify-seed.mjs reads live cards; without the token the step is
// reported as skipped, never as passed.
const finalGame = await load()
const talkLines = (finalGame.state.log ?? []).filter((l) => l.startsWith('PracticeAI: '))
const accessToken = process.env.SUPABASE_ACCESS_TOKEN
if (!accessToken) {
  console.log(`  SKIP  bot_decisions rows — SUPABASE_ACCESS_TOKEN not set (table-talk lines seen: ${talkLines.length})`)
} else {
  const ref = process.env.SUPABASE_PROJECT_REF || 'wpgsjnjnvykxavaxibld'
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `select kind, model, fallback_reason, latency_ms, table_talk from public.bot_decisions where game_id = '${gameId}' order by id` }),
  })
  const rows = res.ok ? await res.json() : []
  step('bot_decisions rows exist for the game', res.ok && rows.length > 0, `HTTP ${res.status}, ${rows.length} rows`)
  const live = rows.filter((r) => r.fallback_reason === null)
  if (rows.length > 0 && rows.every((r) => r.fallback_reason === 'disabled')) {
    step('model disabled on the deployed function — heuristic played, no table-talk', talkLines.length === 0, `${talkLines.length} table-talk lines`)
  } else {
    step('at least one model call succeeded', live.length > 0, rows.map((r) => `${r.kind}:${r.fallback_reason ?? 'ok'}/${r.latency_ms}ms`).join(' '))
    // Not a pass/fail: the model may answer null, or the guard may drop
    // every line over three turns. See table_talk's own note (telemetry.ts,
    // spec §7.1) — this is informational, not a failure.
    console.log(`  ${talkLines.length > 0 ? 'INFO' : 'WARN'}  PracticeAI table-talk lines seen: ${talkLines.length}${talkLines[0] ? ' — ' + talkLines[0] : ''}`)
  }
}

const conceded = await act({ type: 'CONCEDE' })
step('P1 concedes to close the practice game', conceded.status === 200, `HTTP ${conceded.status}`)
game = await load()
step('game complete, bot is the winner', game?.status === 'complete' && game?.winner_id !== p1.userId,
  `status=${game?.status} winner=${game?.winner_id === p1.userId ? 'P1 (wrong)' : game?.winner_id ?? 'none'}`)

await report([{ lobbyId, gameId }], p1)
