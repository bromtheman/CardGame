import { createClient } from 'npm:@supabase/supabase-js@2'
import { applyAction, CATALOG_EFFECTS, CATALOG_HERO_POWERS, normalizeState } from './shared/engine/index.ts'
import { secureRng, snapshotCard } from './shared/engine/gameInit.ts'
import type { SnapshotCard } from './shared/engine/gameInit.ts'
import type { EngineGame, GameAction, PrivateState, Side } from './shared/engine/engineTypes.ts'

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

  if (heroPowerWantsCatalog || zoneEffectWantsCatalog || candidates.some(wantsCatalog)) {
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
  const next = result.game

  // One transaction for public state + both private rows (apply_action_tx,
  // Task 1's migration); null return = version conflict.
  const { data: newVersion, error: txError } = await admin.rpc('apply_action_tx', {
    p_game_id: gameId,
    p_expected_version: row.version,
    p_game: {
      status: next.status,
      winnerId: next.winnerId ?? '',
      turnNumber: next.turnNumber,
      activePlayer: next.activePlayer,
      playerA: next.playerA,
      playerB: next.playerB,
      state: next.state,
    },
    p_a_state: next.privates.a,
    p_b_state: next.privates.b,
  })
  if (txError) return json(500, { errors: [txError.message] })
  if (newVersion === null || newVersion === undefined) {
    return json(409, { errors: ['Version conflict — refresh'] })
  }
  return json(200, { version: newVersion })
})
