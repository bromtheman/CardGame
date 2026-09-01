// battle-report — the endpoint a From The Depths mod reports a fight's outcome to.
//
// Two audiences, so two auth models in one function:
//
//   * `issue` and `fetch` are called by the BROWSER and authenticate the way
//     every other function here does: a Supabase user JWT plus a membership
//     check against the games row.
//   * `submit` is called by the MOD, which has no Supabase session and never
//     gets one. It authenticates with the short-lived, single-use,
//     battle-scoped token that `issue` minted into the `.customBattle` file.
//
// ⚠ **This function never changes game state, and must not learn how.** It
// stores a PREFILL — the HP numbers the report form opens with. A human still
// reads them, presses Submit (SUBMIT_BATTLE_REPORT via `game-action`), and the
// OTHER captain still approves (DECIDE_BATTLE_REPORT, which refuses
// `actor === report.submittedBy` with a 403). That approval is the only
// integrity property in the whole battle-reporting design — the server cannot
// verify a fight happened, here or when a player types the numbers by hand.
// Do not extend this function into submitting or approving.
//
// That restraint is also why it imports ONE shared module instead of the
// engine's whole graph: it dispatches no action, so it needs no handler or
// effect registry, and `shared-manifest.json` lists a single file for it.
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  BATTLE_REPORT_WIRE_VERSION,
  BATTLE_TOKEN_TTL_MS,
  battleKeyOf,
  buildPrefillResults,
  sideForTeamIndex,
} from './shared/battleReport.ts'

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

// ONE message for every way a token can fail to redeem — unknown, already
// used, expired, wrong game, wrong battle. Distinguishing them would let an
// unauthenticated caller probe which tokens exist. It is still written for a
// player, because the mod shows it in an in-game popup.
const TOKEN_REJECTED =
  'This battle token is no longer valid. It may have expired, already been used, ' +
  'or belong to a battle that has finished. Download the battle from the card game again.'

function newToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  // base64url: safe to sit in a JSON file and to echo back in a POST body.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Only the hash is ever stored, so a database leak yields nothing redeemable.
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface BattleState {
  activeBattle: {
    zoneId: number
    aggressor: string
    attackerIds: string[]
    defenderIds: string[]
  } | null
  pendingReport: unknown
}

// Reads the two fields this function cares about straight off the games row.
// No normalizeState: both are plain JSON, and a row old enough to be missing
// them has no active battle either, which the null check below already covers.
function battleStateOf(row: { state: unknown }): BattleState {
  const state = (row.state ?? {}) as Partial<BattleState>
  return {
    activeBattle: state.activeBattle ?? null,
    pendingReport: state.pendingReport ?? null,
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

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return json(400, { errors: ['Invalid JSON body'] })
  }
  const op = typeof body.op === 'string' ? body.op : ''
  const gameId = typeof body.gameId === 'string' ? body.gameId : ''
  if (!gameId) return json(400, { errors: ['gameId is required'] })

  const admin = createClient(supabaseUrl, serviceKey)

  // Shared by `issue` and `fetch`: the browser's JWT plus the same membership
  // check game-action does. Returns the user id, or a Response to send back.
  const signedInParticipant = async (): Promise<
    { userId: string; row: Record<string, unknown> } | Response
  > => {
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: userData, error: userError } = await authClient.auth.getUser()
    if (userError || !userData.user) return json(401, { errors: ['Not signed in'] })
    const userId = userData.user.id
    const { data: row } = await admin.from('games').select('*').eq('id', gameId).maybeSingle()
    if (!row) return json(404, { errors: ['Game not found'] })
    if (row.player_a !== userId && row.player_b !== userId) {
      return json(403, { errors: ['You are not in this game'] })
    }
    return { userId, row }
  }

  // --- issue: mint a token for the battle file the browser is about to build ---
  if (op === 'issue') {
    const found = await signedInParticipant()
    if (found instanceof Response) return found
    const { userId, row } = found

    const { activeBattle } = battleStateOf(row as { state: unknown })
    if (!activeBattle) return json(409, { errors: ['No battle is active in that game'] })

    const side = row.player_a === userId ? 'a' : 'b'
    const battleKey = battleKeyOf(activeBattle)
    const token = newToken()
    const tokenHash = await sha256Hex(token)

    // Retire this player's earlier unredeemed tokens for this game, so exactly
    // one live credential exists per player per game: downloading the battle
    // file again invalidates the copy that came before it.
    await admin.from('battle_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('game_id', gameId).eq('player_id', userId).is('used_at', null)

    const { error: insertError } = await admin.from('battle_tokens').insert({
      token_hash: tokenHash,
      game_id: gameId,
      player_id: userId,
      side,
      zone_id: activeBattle.zoneId,
      battle_key: battleKey,
      expires_at: new Date(Date.now() + BATTLE_TOKEN_TTL_MS).toISOString(),
    })
    if (insertError) return json(500, { errors: [insertError.message] })

    return json(200, {
      version: BATTLE_REPORT_WIRE_VERSION,
      token,
      // Server-authoritative, so the mod never has to be told where to post.
      endpoint: `${supabaseUrl}/functions/v1/battle-report`,
      gameId,
      zoneId: activeBattle.zoneId,
      battleKey,
      side,
    })
  }

  // --- submit: the mod reports the outcome ---
  if (op === 'submit') {
    const token = typeof body.token === 'string' ? body.token : ''
    const battleKey = typeof body.battleKey === 'string' ? body.battleKey : ''
    // Bounded before hashing so an oversized body cannot be used as work.
    if (!token || token.length > 200 || !battleKey) {
      return json(401, { errors: [TOKEN_REJECTED] })
    }
    const tokenHash = await sha256Hex(token)

    // Everything is validated BEFORE the token is redeemed, so a report that
    // cannot land does not burn the player's one credential and strand them.
    const { data: tokenRow } = await admin
      .from('battle_tokens').select('*').eq('token_hash', tokenHash).maybeSingle()
    if (
      !tokenRow || tokenRow.used_at !== null || tokenRow.game_id !== gameId ||
      tokenRow.battle_key !== battleKey || new Date(tokenRow.expires_at).getTime() <= Date.now()
    ) {
      return json(401, { errors: [TOKEN_REJECTED] })
    }

    const { data: row } = await admin.from('games').select('*').eq('id', gameId).maybeSingle()
    if (!row) return json(401, { errors: [TOKEN_REJECTED] })
    if (row.status !== 'active') {
      return json(409, { errors: ['That game has finished.'] })
    }

    const { activeBattle, pendingReport } = battleStateOf(row as { state: unknown })
    if (!activeBattle || battleKeyOf(activeBattle) !== battleKey) {
      return json(409, {
        errors: [
          'That battle is no longer the one under way in the card game. ' +
          'It may already have been reported and resolved.',
        ],
      })
    }
    if (pendingReport !== null) {
      return json(409, {
        errors: [
          'A battle report has already been submitted for this battle — ' +
          'the card game is waiting on the other captain to approve it.',
        ],
      })
    }

    const prefill = buildPrefillResults({
      winningTeamIndex: typeof body.winningTeamIndex === 'number' ? body.winningTeamIndex : undefined,
      vehicles: body.vehicles,
    })
    if (!prefill.ok) return json(400, { errors: [prefill.error] })

    const winningTeamIndex = typeof body.winningTeamIndex === 'number' ? body.winningTeamIndex : null
    const reported = {
      version: BATTLE_REPORT_WIRE_VERSION,
      results: prefill.results,
      names: prefill.names,
      winningTeamIndex,
      // Frozen at report time rather than derived when the overlay reads it:
      // the aggressor is known here, and the interpretation should not drift.
      winningSide: winningTeamIndex === null
        ? null
        : sideForTeamIndex(activeBattle.aggressor, winningTeamIndex),
      reportedBySide: tokenRow.side,
    }

    // Redeem LAST, and atomically — the conditional UPDATE inside the RPC is
    // the single-use mutex. A null return means someone else won the race (or
    // the row changed under us), which is the same opaque failure as above.
    const { data: redeemed, error: redeemError } = await admin.rpc('redeem_battle_token', {
      p_token_hash: tokenHash,
      p_game_id: gameId,
      p_battle_key: battleKey,
      p_reported: reported,
    })
    if (redeemError) return json(500, { errors: [redeemError.message] })
    if (redeemed === null || redeemed === undefined) {
      return json(401, { errors: [TOKEN_REJECTED] })
    }

    return json(200, {
      ok: true,
      vehicles: Object.keys(prefill.results).length,
      message:
        'Result sent to the card game. Open the battle in your browser, check the numbers, ' +
        'and submit the report.',
    })
  }

  // --- fetch: the overlay asks whether a result has arrived ---
  if (op === 'fetch') {
    const found = await signedInParticipant()
    if (found instanceof Response) return found
    const { row } = found

    const { activeBattle } = battleStateOf(row as { state: unknown })
    if (!activeBattle) return json(200, { result: null })

    // Scoped to the battle currently under way, so a result reported for an
    // earlier battle in the same game can never prefill a later one.
    const { data: rows, error } = await admin
      .from('battle_tokens')
      .select('reported, reported_at, side')
      .eq('game_id', gameId)
      .eq('battle_key', battleKeyOf(activeBattle))
      .not('reported', 'is', null)
      .order('reported_at', { ascending: false })
      .limit(1)
    if (error) return json(500, { errors: [error.message] })
    const latest = rows?.[0]
    if (!latest) return json(200, { result: null })
    return json(200, {
      result: { ...(latest.reported as Record<string, unknown>), reportedAt: latest.reported_at },
    })
  }

  return json(400, { errors: [`Unknown op: ${op}`] })
})
