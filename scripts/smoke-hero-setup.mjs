#!/usr/bin/env node
// Set up a game for eyeballing the three 2026-09-06 faction hero powers in the
// browser: P1 hosts a WF deck (Flanking Maneuver), P2 brings SS (Counter
// Intelligence). Prints the game id and P1's side. Always keeps the game —
// there is nothing to assert here; open it in the preview.
//
// Usage:  node scripts/smoke-hero-setup.mjs [--p1 WF] [--p2 SS]
import { signIn, builtIns, startGame } from './smoke-lib.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const p1Faction = arg('p1', 'WF')
const p2Faction = arg('p2', 'SS')

const p1 = await signIn('P1')
const p2 = await signIn('P2')
const cards = await builtIns(p1.token)
const g = await startGame(p1, p2, {
  label: `hero-${p1Faction}-${p2Faction}`,
  materialsPerTurn: 300_000,
  p1Faction, p1Required: [],
  p2Faction, p2Required: [],
}, cards)
const side = await g.sideOf(p1)

const myTurn = await g.activeIs(p1)
console.log(JSON.stringify({ gameId: g.gameId, lobbyId: g.lobbyId, p1Side: side, p1Turn: myTurn }))
