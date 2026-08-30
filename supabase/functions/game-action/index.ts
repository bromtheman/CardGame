import { createClient } from 'npm:@supabase/supabase-js@2'
import { applyAction, CATALOG_EFFECTS, normalizeState } from './shared/engine/index.ts'
import { secureRng, snapshotCard } from './shared/engine/gameInit.ts'
import type { SnapshotCard } from './shared/engine/gameInit.ts'
import type { EngineGame, GameAction, PrivateState, Side } from './shared/engine/engineTypes.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData, error: userError } = await authClient.auth.getUser()
  if (userError || !userData.user) return json(401, { errors: ['Not signed in'] })
  const userId = userData.user.id

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

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: row } = await admin.from('games').select('*').eq('id', gameId).maybeSingle()
  if (!row) return json(404, { errors: ['Game not found'] })
  if (row.player_a !== userId && row.player_b !== userId) {
    return json(403, { errors: ['You are not in this game'] })
  }
  if (row.version !== expectedVersion) {
    return json(409, { errors: ['Version conflict — refresh'] })
  }
  const { data: playerRows } = await admin
    .from('game_players').select('*').eq('game_id', gameId)
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

  if (zoneEffectWantsCatalog || candidates.some(wantsCatalog)) {
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
