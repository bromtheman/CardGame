#!/usr/bin/env node
// Live smoke test for `battle-report` — the endpoint the From The Depths mod
// posts a fight's outcome to. Plumbing lives in ./smoke-lib.mjs; this file is
// scenarios only.
//
// It exists because NOTHING ELSE CAN COVER THIS CODE. `battle-report/index.ts`
// is Deno edge code: the root tsconfig's `include` is ["shared","supabase/seed"],
// so `npx tsc` never reads it, and there is no Deno test harness in this repo.
// The pure parts are unit-tested in shared/battleReport.test.ts; the auth,
// the RPC, the single-use mutex and the RLS-invisible table are only ever
// exercised here.
//
// What it proves that no unit test can:
//
//   * A CALLER WITH NO SUPABASE SESSION CAN SUBMIT. The whole point: the mod
//     has no user JWT and never gets one. The `submit` op deliberately does
//     not call auth.getUser(), and this drives it with the anon key alone.
//   * THE TOKEN IS SINGLE USE. The mutex is a conditional UPDATE inside
//     redeem_battle_token; a second POST with the same token must fail.
//   * EVERY TOKEN FAILURE LOOKS THE SAME. Unknown, wrong battle, already
//     used — one opaque 401, so an unauthenticated caller cannot probe.
//   * THE PREFILL SATISFIES THE ENGINE. This is the one that matters most:
//     SUBMIT_BATTLE_REPORT refuses a report that does not cover EXACTLY
//     battleParticipants, and battle-report deliberately does not know the
//     roster. The run below feeds the prefilled numbers straight into a real
//     SUBMIT_BATTLE_REPORT and then approves it, so a coverage mismatch fails
//     here rather than in a player's game.
//   * THE HANDSHAKE IS UNCHANGED. The report is still submitted by a player
//     and approved by the OTHER one. Nothing in this feature may route around
//     DECIDE_BATTLE_REPORT's `actor === report.submittedBy` 403, and the run
//     asserts the submitter cannot approve their own report.
//
// Requires the migration applied and the function deployed — it fails loudly
// with a pointer if either is missing.
//
// Usage:  node scripts/smoke-battle-report.mjs [--keep]
//   --keep   leave the game and lobby behind for browser inspection
//
// Credentials come from scripts/qa-accounts.local (gitignored).

import {
  step, die, fn, signIn, builtIns, startGame, report, keep,
} from './smoke-lib.mjs'

// Deliberately RE-DERIVED here rather than imported from
// shared/battleReport.ts. Importing the implementation would make this
// assertion circular — it would pass whatever battleKeyOf did. Six lines of
// duplication buys an independent check that the server keyed the battle the
// way the file says it does.
function expectedBattleKey(battle) {
  const ids = (xs) => [...xs].sort().join(',')
  return [battle.zoneId, battle.aggressor, ids(battle.attackerIds), ids(battle.defenderIds)].join('|')
}

console.log('\n  battle-report live smoke test — reporting a fight back from FtD\n')

const p1 = await signIn('P1')
const p2 = await signIn('P2')
step('signed in both QA accounts', true, `${p1.email} / ${p2.email}`)

const cards = await builtIns(p1.token)
const g = await startGame(p1, p2, {
  label: 'battle-report',
  // Generous income so both sides get a ship onto the board in a few turns —
  // the battle is the subject here, not the economy. No `required` cards: any
  // two ships will do.
  materialsPerTurn: 300_000,
  p1Faction: 'DWG', p1Required: [],
  p2Faction: 'OW', p2Required: [],
}, cards)
step('started a game', true, g.gameId)

// ---------------------------------------------------------------- a battle

const mine = await g.deployShip(p1, 1)
if (!mine) die('could not get a ship onto zone 1 for P1')
const theirs = await g.deployShip(p2, 1)
if (!theirs) die('could not get a ship onto zone 1 for P2')
step('both fleets on zone 1', true, `${mine.name} vs ${theirs.name}`)

await g.passTo(p1)
const attack = await g.attempt(p1, {
  type: 'ATTACK_ENEMY_FLEET', zoneId: 1,
  attackerIds: [mine.instanceId], targetIds: [theirs.instanceId],
})
step('declared a fleet battle', attack.status === 200, JSON.stringify(attack.body).slice(0, 160))
// ATTACK_ENEMY_FLEET does not always lock: a Stealthy or omissible defender
// raises the response window instead.
await g.lockIfPending(p2)

let game = await g.load(p1)
const battle = game.state.activeBattle
step('battle is locked', !!battle, battle ? `zone ${battle.zoneId}` : 'no activeBattle')
const participantIds = [...battle.attackerIds, ...battle.defenderIds]

// ------------------------------------------------------------------ issue

const issued = await fn('battle-report', p1.token, { op: 'issue', gameId: g.gameId })
if (issued.status === 404) {
  die('battle-report is not deployed — run `npm run functions:deploy -- battle-report` first')
}
step('issued a battle token', issued.status === 200 && !!issued.body?.token,
  `HTTP ${issued.status}`)
step('token is scoped to THIS battle',
  issued.body?.battleKey === expectedBattleKey(battle),
  `${issued.body?.battleKey} vs ${expectedBattleKey(battle)}`)
step('endpoint is server-authoritative',
  typeof issued.body?.endpoint === 'string' && issued.body.endpoint.endsWith('/battle-report'),
  issued.body?.endpoint)

const nonParticipant = await fn('battle-report', p2.token, { op: 'issue', gameId: g.gameId })
step('the other captain can mint their own token too',
  nonParticipant.status === 200 && nonParticipant.body?.side !== issued.body?.side,
  `sides ${issued.body?.side} / ${nonParticipant.body?.side}`)

// ----------------------------------------------------------------- submit

// The HP the mod would report. 0.87 survives (SURVIVE_HP_PERCENT is 90 → 87 is
// in the repair band); the defender is gone, which FtD's own cleanup rules
// (TooDamaged 0.55) make the ordinary outcome for a wreck.
const vehicles = [
  { instanceId: mine.instanceId, name: mine.name, aliveFraction: 0.87, exists: true },
  { instanceId: theirs.instanceId, name: theirs.name, aliveFraction: 0.42, exists: false },
]
const submitBody = {
  op: 'submit',
  gameId: g.gameId,
  battleKey: issued.body.battleKey,
  token: issued.body.token,
  winningTeamIndex: 0,
  vehicles,
}

const badToken = await fn('battle-report', undefined, { ...submitBody, token: 'not-a-real-token' })
step('an unknown token is refused', badToken.status === 401, `HTTP ${badToken.status}`)

const wrongBattle = await fn('battle-report', undefined, { ...submitBody, battleKey: '9|a|x|y' })
step('a token echoing the wrong battle is refused', wrongBattle.status === 401,
  `HTTP ${wrongBattle.status}`)
step('both refusals are byte-identical, so a caller cannot probe',
  JSON.stringify(badToken.body) === JSON.stringify(wrongBattle.body),
  JSON.stringify(badToken.body).slice(0, 120))

// The load-bearing one: NO Authorization beyond the anon key. This is exactly
// what the mod sends.
const submitted = await fn('battle-report', undefined, submitBody)
step('a caller with no Supabase session can submit the result',
  submitted.status === 200, `HTTP ${submitted.status}: ${JSON.stringify(submitted.body).slice(0, 200)}`)

const replay = await fn('battle-report', undefined, submitBody)
step('the token is single use', replay.status === 401, `HTTP ${replay.status}`)

// ------------------------------------------------------------------ fetch

const fetched = await fn('battle-report', p2.token, { op: 'fetch', gameId: g.gameId })
const prefill = fetched.body?.result
step('the other captain can read the prefill', fetched.status === 200 && !!prefill,
  `HTTP ${fetched.status}`)
step('alive fraction became an HP percent',
  prefill?.results?.[mine.instanceId] === 87,
  `${mine.name} -> ${prefill?.results?.[mine.instanceId]}`)
step('a vehicle that no longer exists is 0, whatever its fraction said',
  prefill?.results?.[theirs.instanceId] === 0,
  `${theirs.name} -> ${prefill?.results?.[theirs.instanceId]}`)
step('the winning team index resolved to the aggressor\'s side',
  prefill?.winningSide === (await g.sideOf(p1)),
  `${prefill?.winningSide} vs ${await g.sideOf(p1)}`)

const outsider = await fn('battle-report', undefined, { op: 'fetch', gameId: g.gameId })
step('an unauthenticated caller cannot read the prefill', outsider.status === 401,
  `HTTP ${outsider.status}`)

// ------------------------------- the prefill has to satisfy the real engine

step('the prefill covers exactly the battle roster',
  participantIds.length === Object.keys(prefill.results).length &&
    participantIds.every((id) => id in prefill.results),
  `${Object.keys(prefill.results).length} of ${participantIds.length}`)

const realSubmit = await g.act(p1, {
  type: 'SUBMIT_BATTLE_REPORT', results: prefill.results, repairs: [],
})
step('SUBMIT_BATTLE_REPORT accepts the prefilled numbers unedited',
  realSubmit.status === 200,
  `HTTP ${realSubmit.status}: ${JSON.stringify(realSubmit.body).slice(0, 200)}`)

const selfApprove = await g.act(p1, { type: 'DECIDE_BATTLE_REPORT', approve: true })
step('the submitter still cannot approve their own report', selfApprove.status === 403,
  `HTTP ${selfApprove.status}`)

const decided = await g.act(p2, { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [] })
step('the other captain approves it', decided.status === 200,
  `HTTP ${decided.status}: ${JSON.stringify(decided.body).slice(0, 200)}`)

game = await g.load(p1)
step('the battle resolved', game.state.activeBattle === null && game.state.pendingReport === null)
step('the reported wreck left the board',
  !JSON.stringify(game.state.zones).includes(theirs.instanceId),
  `${theirs.name} destroyed`)

// A token minted for a battle that has since resolved must be dead.
const stale = await fn('battle-report', undefined, {
  ...submitBody, token: nonParticipant.body.token, battleKey: nonParticipant.body.battleKey,
})
step('a token for a finished battle is refused', stale.status === 409 || stale.status === 401,
  `HTTP ${stale.status}`)

await report([g], p1)
