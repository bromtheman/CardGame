import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { applyAction, CATALOG_EFFECTS, CATALOG_HERO_POWERS, normalizeState } from './shared/engine/index.ts'
import { secureRng, snapshotCard } from './shared/engine/gameInit.ts'
import type { SnapshotCard } from './shared/engine/gameInit.ts'
import type { EngineGame, GameAction, PrivateState, Side } from './shared/engine/engineTypes.ts'
import { makeBotPolicy } from './shared/ai/llm/makePolicy.ts'
import { toBotDecisionRow } from './shared/ai/llm/telemetry.ts'
import type { TelemetryRow } from './shared/ai/llm/telemetry.ts'
import { runBotUntilIdle } from './shared/ai/botDriver.ts'
import { botPlayerId, botSideOf } from './shared/ai/botGame.ts'

// Same block as battle-report/index.ts — the comment there says why x-region
// and Max-Age are here. Keep the four functions equal.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '7200',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// A checkpoint commit that failed: carries the response the human gets (the
// 409 or the 500), thrown through the driver so the bot's turn stops there.
class CommitFailed extends Error {
  response: Response
  constructor(response: Response) {
    super('commit failed')
    this.name = 'CommitFailed'
    this.response = response
  }
}

// Supabase's runtime keeps the isolate alive for a promise handed to
// EdgeRuntime.waitUntil after the response is sent; `deno check` does not
// know the global, so it is declared here. Absent (local tooling), the
// promise simply runs detached.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined
function afterResponse(work: Promise<unknown>): void {
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(work)
  else void work
}

// Telemetry for the model-backed PracticeAI (LLM spec §7.2): best effort,
// after the commit, never on the player's path. Same function in lobby-action.
async function recordBotDecisions(
  admin: SupabaseClient, gameId: string, version: number, rows: TelemetryRow[],
): Promise<void> {
  if (rows.length === 0) return
  const { error } = await admin.from('bot_decisions').insert(rows.map((r) => toBotDecisionRow(r, gameId, version)))
  if (error) console.error('bot_decisions insert failed:', error.message)
}

// --- caller identity, verified locally --------------------------------------
//
// `getClaims` checks the JWT's signature against the project's public signing
// keys (ES256 here) with WebCrypto, instead of `getUser()`'s round trip to
// GoTrue on every request. The keys are fetched once and cached for ten
// minutes ON THE CLIENT INSTANCE — which is why this client is module-scoped
// and created lazily rather than per request: a fresh client each time would
// just trade one network call for another.
//
// What changes: a session revoked, or a user deleted, mid-token stays valid
// until that token expires (one hour). Accepted 2026-09-16 — nothing
// player-facing hangs on that hour. What does not change: an expired,
// tampered, or foreign-project token is still refused (the last through
// getClaims' own getUser fallback for an unknown key id), and every 4xx
// below still comes in the same order. The same block lives in all four
// functions; keep them equal.
let verifier: ReturnType<typeof createClient> | null = null
async function verifiedUserId(
  req: Request, supabaseUrl: string, anonKey: string,
): Promise<string | null> {
  const header = req.headers.get('Authorization') ?? ''
  const jwt = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!jwt) return null
  verifier ??= createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  try {
    const { data, error } = await verifier.auth.getClaims(jwt)
    if (error || !data) return null
    const { sub, role } = data.claims
    return role === 'authenticated' && typeof sub === 'string' && sub !== '' ? sub : null
  } catch {
    // A verification failure that is not an auth error (WebCrypto, a JWKS
    // fetch that threw) reads as "not signed in", exactly as getUser()'s
    // network failures did.
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { errors: ['POST only'] })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { errors: ['Server misconfigured: missing Supabase environment'] })
  }

  // Local, cheap checks first — no credential at all is a 401 before any
  // work, and a malformed body is a 400 before any round trip.
  if (!(req.headers.get('Authorization') ?? '').startsWith('Bearer ')) {
    return json(401, { errors: ['Not signed in'] })
  }
  let body: { gameId?: unknown; expectedVersion?: unknown; action?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { errors: ['Invalid JSON body'] })
  }
  const gameId = typeof body.gameId === 'string' ? body.gameId : ''
  const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : -1
  const action = body.action as GameAction | undefined
  if (!gameId || expectedVersion < 0 || !action || typeof action.type !== 'string') {
    return json(400, { errors: ['gameId, expectedVersion, and action are required'] })
  }

  // Three round trips that never depended on each other — the token check
  // needs only the header, the two reads need only gameId — run as one. The
  // membership and version checks below still gate everything that follows,
  // in the same order as before, and a refused caller is sent nothing from
  // the reads. (An unauthenticated request now costs two indexed reads whose
  // results are discarded; it already cost a GoTrue call.)
  const admin = createClient(supabaseUrl, serviceKey)
  const [userId, { data: row }, { data: playerRows }] = await Promise.all([
    verifiedUserId(req, supabaseUrl, anonKey),
    admin.from('games').select('*').eq('id', gameId).maybeSingle(),
    admin.from('game_players').select('*').eq('game_id', gameId),
  ])
  if (!userId) return json(401, { errors: ['Not signed in'] })
  if (!row) return json(404, { errors: ['Game not found'] })
  if (row.player_a !== userId && row.player_b !== userId) {
    return json(403, { errors: ['You are not in this game'] })
  }
  if (row.version !== expectedVersion) {
    return json(409, { errors: ['Version conflict — refresh'] })
  }
  const aRow = playerRows?.find((p) => p.player_id === row.player_a)
  const bRow = playerRows?.find((p) => p.player_id === row.player_b)
  if (!aRow || !bRow) return json(500, { errors: ['Game state is incomplete'] })

  const engineGame: EngineGame = {
    id: row.id,
    playerA: row.player_a,
    playerB: row.player_b,
    status: row.status as EngineGame['status'],
    winnerId: row.winner_id,
    turnNumber: Number(row.turn_number),
    activePlayer: row.active_player,
    settings: row.settings as EngineGame['settings'],
    state: row.state as EngineGame['state'],
    privates: {
      a: { hand: aRow.hand, deck: aRow.deck } as PrivateState,
      b: { hand: bRow.hand, deck: bRow.deck } as PrivateState,
    },
  }
  // Rows created before this phase (or by an older lobby-action deploy) lack
  // the new state fields — repair the shape before the engine sees it.
  normalizeState(engineGame.state)

  // Load the built-in card catalog when any card that this action could fire
  // an effect on references a catalog effect. Scanning the played hand card
  // alone misses death effects (which fire during DECIDE_BATTLE_REPORT with
  // no instanceId) and on-field activated abilities.
  let catalog: SnapshotCard[] = []
  const mySide: Side = row.player_a === userId ? 'a' : 'b'
  const wantsCatalog = (card: { meta?: Record<string, unknown> } | undefined): boolean =>
    card !== undefined &&
    Object.values(card.meta ?? {}).some(
      (v) => typeof v === 'string' && CATALOG_EFFECTS.has(v.trim()),
    )

  const candidates: { meta?: Record<string, unknown> }[] = []
  const actionInstanceId = (action as { instanceId?: unknown }).instanceId
  if (typeof actionInstanceId === 'string') {
    const played = engineGame.privates[mySide].hand.find((c) => c.instanceId === actionInstanceId)
    if (played) candidates.push(played)
  }
  for (const zone of engineGame.state.zones) {
    candidates.push(...zone.cards.a, ...zone.cards.b)
  }

  // A resolving choice's card is in neither hand nor field — it was spent when
  // it was played — so the probe would miss a catalog effect that has only
  // just been asked for its second phase (spec §4.7).
  if (engineGame.state.pendingEffect) candidates.push(engineGame.state.pendingEffect.card)

  // Fourth source (wave 4): a persistent zone claim keeps firing long after its
  // card was spent, so it is in none of the three above — not in a hand, not on
  // the field, and not the pending card until it has already suspended once.
  // DWG Waters is the case: its battle-time riders mint a guest hull out of the
  // catalog, and both would resolve against an empty one. The entry stores the
  // registry name directly, so this needs no card lookup — it asks
  // CATALOG_EFFECTS about the name itself.
  const zoneEffectWantsCatalog = engineGame.state.zoneEffects.some(
    (e) => typeof e.effect === 'string' && CATALOG_EFFECTS.has(e.effect.trim()),
  )

  // Fifth source: a hero power that mints from the catalog (TG Drones' Mirth
  // Swarms). A hero power has no card and no meta, so none of the probes
  // above can see it — it declares itself in CATALOG_HERO_POWERS instead.
  const heroPowerWantsCatalog =
    action.type === 'USE_HERO_POWER' && CATALOG_HERO_POWERS.has(String(action.power))

  // Sixth source (2026-09-16 AI opponent spec §5.4): a practice game. The
  // bot's own plays are in none of the probes above — its hand is not the
  // caller's — so the catalog is loaded unconditionally for one.
  const practiceGame = botSideOf(engineGame.settings) !== null
  if (heroPowerWantsCatalog || zoneEffectWantsCatalog || practiceGame || candidates.some(wantsCatalog)) {
    const { data: cardRows, error: catalogError } = await admin.from('cards').select('*').eq('is_built_in', true)
    if (catalogError) return json(500, { errors: ['Failed to load the card catalog'] })
    catalog = (cardRows ?? []).map(snapshotCard)
  }
  const ctx = { rng: secureRng, newId: () => crypto.randomUUID(), catalog }

  let result: ReturnType<typeof applyAction>
  try {
    result = applyAction(engineGame, userId, action, ctx)
  } catch {
    return json(400, { errors: ['Malformed action'] })
  }
  if (!result.ok) return json(result.status, { errors: [result.error] })
  let next = result.game

  // One transaction per commit (apply_action_tx, Task 1's migration): public
  // state + both private rows, guarded by the version the previous commit
  // returned; null return = version conflict. A practice game commits the
  // human's action with the bot's first checkpoint (its opening marker),
  // then at every section boundary, then once more with the rest (2026-09-18
  // sectioned bot turn spec §5.4) — so the human's board redraws as the bot
  // plays. Any other game commits exactly once, below.
  const commits = { version: row.version as number, last: null as EngineGame | null }
  const commit = async (game: EngineGame): Promise<Response | null> => {
    const { data: newVersion, error: txError } = await admin.rpc('apply_action_tx', {
      p_game_id: gameId,
      p_expected_version: commits.version,
      p_game: {
        status: game.status,
        winnerId: game.winnerId ?? '',
        turnNumber: game.turnNumber,
        activePlayer: game.activePlayer,
        playerA: game.playerA,
        playerB: game.playerB,
        state: game.state,
      },
      p_a_state: game.privates.a,
      p_b_state: game.privates.b,
    })
    if (txError) return json(500, { errors: [txError.message] })
    if (newVersion === null || newVersion === undefined) return json(409, { errors: ['Version conflict — refresh'] })
    commits.version = newVersion as number
    commits.last = game
    return null
  }

  // A practice game: the bot acts until it owes nothing, in memory, committing
  // at its checkpoints. The policy is the model-backed one when
  // OPENROUTER_API_KEY is set (LLM spec §3.4), the evaluator (scoredPolicy)
  // otherwise — and the evaluator is also what a model failure falls back
  // to (2026-09-19 scored menu spec §6.4): it never surfaces here, the
  // policy files a telemetry row and plays by score for the rest of the
  // request. A throw is an engine bug surfacing — answered as its own 500
  // with the sections already committed standing (sectioned spec §11).
  // CONCEDE/ABANDON end the game first, so botOwes is null for them.
  const botId = botPlayerId(next)
  const policy = botId ? makeBotPolicy({
    OPENROUTER_API_KEY: Deno.env.get('OPENROUTER_API_KEY'),
    BOT_MODEL: Deno.env.get('BOT_MODEL'),
    BOT_LLM_DISABLED: Deno.env.get('BOT_LLM_DISABLED'),
    BOT_REASONING_EFFORT: Deno.env.get('BOT_REASONING_EFFORT'),
    BOT_PROVIDERS: Deno.env.get('BOT_PROVIDERS'),
    BOT_FLOW: Deno.env.get('BOT_FLOW'),
  }) : null
  if (botId && policy) {
    try {
      next = (await runBotUntilIdle(next, botId, ctx, policy, async (game) => {
        const failed = await commit(game)
        if (failed) throw new CommitFailed(failed)
      })).game
    } catch (err) {
      if (err instanceof CommitFailed) return err.response
      return json(500, { errors: [`AI opponent failed: ${err instanceof Error ? err.message : String(err)}`] })
    }
  }

  if (commits.last !== next) {
    const failed = await commit(next)
    if (failed) return failed
  }
  if (policy) afterResponse(recordBotDecisions(admin, gameId, commits.version, policy.rows))
  return json(200, { version: commits.version })
})
