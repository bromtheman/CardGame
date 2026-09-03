import { createClient } from 'npm:@supabase/supabase-js@2'
import { DEFAULT_DECK_RULES, validateDeck } from './shared/engine/deckValidation.ts'
import type { DeckCardInfo } from './shared/engine/deckValidation.ts'
import { buildInitialGame, secureRng, snapshotCard } from './shared/engine/gameInit.ts'
import type { SnapshotCard } from './shared/engine/gameInit.ts'
import { validateLobbySettings } from './shared/lobbySettings.ts'

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

  let body: {
    action?: unknown; lobbyId?: unknown; deckId?: unknown
    ready?: unknown; settings?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json(400, { errors: ['Invalid JSON body'] })
  }
  const action = typeof body.action === 'string' ? body.action : ''
  const lobbyId = typeof body.lobbyId === 'string' ? body.lobbyId : ''
  const deckId = typeof body.deckId === 'string' ? body.deckId : ''
  if (!lobbyId) return json(400, { errors: ['lobbyId required'] })

  const admin = createClient(supabaseUrl, serviceKey)

  if (action === 'JOIN') {
    // deckId is optional now: seats are claimed first and decked in the lobby
    // (spec R-2). It is still accepted so a frontend deployed before this
    // function keeps working through the rollout window.
    let joinFaction: string | null = null
    if (deckId) {
      const { data: deck } = await admin
        .from('decks').select('id, owner_id, faction').eq('id', deckId).maybeSingle()
      if (!deck || deck.owner_id !== userId) {
        return json(403, { errors: ['That deck is not yours'] })
      }
      joinFaction = deck.faction
    }
    // Atomic claim: only succeeds while the seat is empty and the lobby open.
    // guest_faction is written in the same statement as guest_deck_id (spec
    // §3.1.1's "cannot disagree" claim) — null alongside null when no deckId
    // was supplied. guest_ready is cleared defensively: LEAVE/KICK are today
    // the only writers of guest_id = null, but that should not be load-bearing
    // here too.
    const { data: claimed, error: claimError } = await admin
      .from('lobbies')
      .update({
        guest_id: userId,
        guest_deck_id: deckId || null,
        guest_faction: joinFaction,
        guest_ready: false,
      })
      .eq('id', lobbyId)
      .eq('status', 'open')
      .is('guest_id', null)
      .neq('host_id', userId)
      .select()
      .maybeSingle()
    if (claimError) return json(500, { errors: [claimError.message] })
    if (!claimed) return json(409, { errors: ['Lobby is full, closed, or your own'] })
    return json(200, { lobby: claimed })
  }

  if (action === 'LEAVE') {
    const { data: left, error: leaveError } = await admin
      .from('lobbies')
      .update({ guest_id: null, guest_deck_id: null, guest_faction: null, guest_ready: false })
      .eq('id', lobbyId)
      .eq('status', 'open')
      .eq('guest_id', userId)
      .select()
      .maybeSingle()
    if (leaveError) return json(500, { errors: [leaveError.message] })
    if (!left) return json(409, { errors: ['You are not the guest of that open lobby'] })
    return json(200, { ok: true })
  }

  // Every op below is conditioned on status = 'open' inside its own WHERE, so
  // none of them can mutate a lobby that START has already locked to
  // 'starting'. Reading the row first and updating second would leave exactly
  // that window open.

  if (action === 'SET_DECK') {
    if (!deckId) return json(400, { errors: ['deckId required'] })
    const { data: deck } = await admin
      .from('decks').select('id, owner_id, faction').eq('id', deckId).maybeSingle()
    if (!deck || deck.owner_id !== userId) {
      return json(403, { errors: ['That deck is not yours'] })
    }
    const { data: lobby } = await admin
      .from('lobbies').select('host_id, guest_id').eq('id', lobbyId).maybeSingle()
    if (!lobby) return json(404, { errors: ['Lobby not found'] })

    const isHost = lobby.host_id === userId
    const isGuest = lobby.guest_id === userId
    if (!isHost && !isGuest) return json(403, { errors: ['You are not in that lobby'] })

    // Three things happen here. The faction is copied onto the lobby (spec
    // §3.1.1) because decks_select_own means the opponent's deck row is
    // unreadable by the client — faction is the ONLY field that crosses, so
    // the deck's name and contents stay structurally out of reach rather than
    // merely unrendered. Changing your deck drops your OWN ready flag (§4.1):
    // you re-affirm after changing what you are bringing. And when the HOST
    // changes deck, it also drops guest_ready: the opponent's faction badge is
    // what the guest read before readying, so a host-side swap invalidates
    // that consent the same way UPDATE_SETTINGS does — the guest changing
    // their own deck carries no such obligation, since the host still holds
    // the Start button and can simply look before pressing it.
    const patch = isHost
      ? { host_deck_id: deckId, host_faction: deck.faction, host_ready: false, guest_ready: false }
      : { guest_deck_id: deckId, guest_faction: deck.faction, guest_ready: false }

    // The identity predicate belongs in the UPDATE's own WHERE, not only in
    // the read above: without it, a caller kicked or replaced between the
    // read and this write would still match status='open' and could clobber
    // the new occupant's row (TOCTOU).
    let query = admin.from('lobbies').update(patch).eq('id', lobbyId).eq('status', 'open')
    query = isHost ? query.eq('host_id', userId) : query.eq('guest_id', userId)
    const { data: updated, error: updateError } = await query.select().maybeSingle()
    if (updateError) return json(500, { errors: [updateError.message] })
    if (!updated) {
      return json(409, { errors: ['Lobby is no longer open, or you are no longer in it'] })
    }
    return json(200, { ok: true })
  }

  if (action === 'SET_READY') {
    if (typeof body.ready !== 'boolean') return json(400, { errors: ['ready must be a boolean'] })
    const ready = body.ready
    const { data: lobby } = await admin
      .from('lobbies').select('host_id, guest_id, host_deck_id, guest_deck_id')
      .eq('id', lobbyId).maybeSingle()
    if (!lobby) return json(404, { errors: ['Lobby not found'] })

    const isHost = lobby.host_id === userId
    const isGuest = lobby.guest_id === userId
    if (!isHost && !isGuest) return json(403, { errors: ['You are not in that lobby'] })

    const myDeck = isHost ? lobby.host_deck_id : lobby.guest_deck_id
    if (ready && !myDeck) return json(409, { errors: ['Pick a deck before readying up'] })

    // The identity predicate belongs in the UPDATE's own WHERE, not only in
    // the read above: without it, a caller kicked or replaced between the
    // read and this write would still match status='open' and could clobber
    // the new occupant's row (TOCTOU).
    let query = admin.from('lobbies')
      .update(isHost ? { host_ready: ready } : { guest_ready: ready })
      .eq('id', lobbyId).eq('status', 'open')
    query = isHost ? query.eq('host_id', userId) : query.eq('guest_id', userId)
    const { data: updated, error: updateError } = await query.select().maybeSingle()
    if (updateError) return json(500, { errors: [updateError.message] })
    if (!updated) {
      return json(409, { errors: ['Lobby is no longer open, or you are no longer in it'] })
    }
    return json(200, { ok: true })
  }

  if (action === 'UPDATE_SETTINGS') {
    const parsed = validateLobbySettings(body.settings)
    if ('errors' in parsed) return json(400, { errors: parsed.errors })

    // Clears guest_ready, never host_ready (spec §4.1): the host authored the
    // change, so their consent is implicit; the guest re-affirms against the
    // battlefield they can now see in the preview.
    const { data: updated, error: updateError } = await admin
      .from('lobbies')
      .update({ settings: parsed.settings, guest_ready: false })
      .eq('id', lobbyId).eq('status', 'open').eq('host_id', userId)
      .select().maybeSingle()
    if (updateError) return json(500, { errors: [updateError.message] })
    if (!updated) return json(409, { errors: ['Only the host can change an open lobby'] })
    return json(200, { ok: true })
  }

  if (action === 'KICK') {
    const { data: updated, error: updateError } = await admin
      .from('lobbies')
      .update({ guest_id: null, guest_deck_id: null, guest_faction: null, guest_ready: false })
      .eq('id', lobbyId).eq('status', 'open').eq('host_id', userId)
      .select().maybeSingle()
    if (updateError) return json(500, { errors: [updateError.message] })
    if (!updated) return json(409, { errors: ['Only the host can remove a player from an open lobby'] })
    return json(200, { ok: true })
  }

  if (action === 'START') {
    const { data: lobby } = await admin
      .from('lobbies').select('*').eq('id', lobbyId).maybeSingle()
    if (!lobby) return json(404, { errors: ['Lobby not found'] })
    if (lobby.host_id !== userId) return json(403, { errors: ['Only the host can start'] })
    if (lobby.status !== 'open') return json(409, { errors: ['Lobby is not open'] })

    const parsed = validateLobbySettings(lobby.settings)
    if ('errors' in parsed) return json(400, { errors: parsed.errors })

    // Mark starting so concurrent STARTs, JOINs, and LEAVEs can't race. The
    // guest-present conditions live in the WHERE so a guest who left between
    // our read and this lock makes the lock fail instead of starting a game
    // around a stale seat. `locked` is the post-lock authoritative row —
    // everything below reads from it, never from the pre-lock `lobby`.
    const { data: locked } = await admin
      .from('lobbies')
      .update({ status: 'starting' })
      .eq('id', lobbyId)
      .eq('status', 'open')
      .not('guest_id', 'is', null)
      .not('guest_deck_id', 'is', null)
      .not('host_deck_id', 'is', null)
      .eq('host_ready', true)
      .eq('guest_ready', true)
      .select()
      .maybeSingle()
    if (!locked || !locked.guest_id || !locked.guest_deck_id || !locked.host_deck_id) {
      return json(409, {
        errors: ['Both players need a deck and a ready check before the battle can begin'],
      })
    }

    try {
      const fail = async (status: number, errors: string[]) => {
        await admin.from('lobbies').update({ status: 'open' }).eq('id', lobbyId).eq('status', 'starting')
        return json(status, { errors })
      }

      // Re-validate against `locked`, the post-lock row, not the pre-lock
      // `lobby` read above. Between that read and the lock succeeding, the
      // host could have called UPDATE_SETTINGS again — writing new settings
      // and clearing guest_ready — and the guest could have readied against
      // THOSE settings before this START's lock statement (which only checks
      // guest_ready, not which settings it was readied against) went through.
      // Using the stale `parsed.settings` below would then permanently write
      // into games.settings a configuration the guest never agreed to, with
      // no way to renegotiate once the game exists. The cheap pre-lock check
      // above still usefully bails before taking the mutex on a malformed row;
      // this is the authoritative one.
      const lockedParsed = validateLobbySettings(locked.settings)
      if ('errors' in lockedParsed) return fail(400, lockedParsed.errors)

      const { data: decks } = await admin
        .from('decks').select('*').in('id', [locked.host_deck_id, locked.guest_deck_id])
      const hostDeck = decks?.find((d) => d.id === locked.host_deck_id)
      const guestDeck = decks?.find((d) => d.id === locked.guest_deck_id)
      if (!hostDeck || !guestDeck) return fail(409, ['A selected deck no longer exists'])
      if (hostDeck.owner_id !== locked.host_id) {
        return fail(403, ['Host deck is not owned by the host'])
      }
      if (guestDeck.owner_id !== locked.guest_id) {
        return fail(403, ['Guest deck is not owned by the guest'])
      }

      const hostCards = (hostDeck.cards ?? {}) as Record<string, number>
      const guestCards = (guestDeck.cards ?? {}) as Record<string, number>
      const cardIds = [...new Set([...Object.keys(hostCards), ...Object.keys(guestCards)])]
      const { data: cardRows } = await admin.from('cards').select('*').in('id', cardIds)
      const infoMap = new Map<string, DeckCardInfo>(
        (cardRows ?? []).map((c) => [c.id, {
          id: c.id, isBuiltIn: c.is_built_in, faction: c.faction,
          vehicleType: c.vehicle_type, ownerId: c.owner_id,
          summonOnly: (c.meta as { summonOnly?: boolean } | null)?.summonOnly === true,
          retired: (c.meta as { retired?: boolean } | null)?.retired === true,
        }]),
      )
      const snapshots = new Map<string, SnapshotCard>(
        (cardRows ?? []).map((c) => [c.id, snapshotCard(c)]),
      )

      // validateDeck's errors are keyed by card id — shared/ has no name
      // lookup and should not grow one. A uuid means nothing to a lobby owner
      // staring at a failed START (spec §2.2's "no way to see why"), so swap
      // in the printed name for every id this map already knows, from the
      // cardRows we already fetched above.
      const nameById = new Map((cardRows ?? []).map((c) => [c.id as string, c.name as string]))
      const withCardNames = (errors: string[]) => errors.map((e) => {
        let msg = e
        for (const [id, name] of nameById) msg = msg.split(id).join(name)
        return msg
      })

      // Lobby-overridable deck rules (spec §4): defaults merged with any
      // validated per-lobby overrides, then frozen into the game's settings.
      const deckRules = { ...DEFAULT_DECK_RULES, ...(lockedParsed.settings.deckRules ?? {}) }

      const hostResult = validateDeck(
        { faction: hostDeck.faction, cards: hostCards }, infoMap, locked.host_id, deckRules,
      )
      if (!hostResult.valid) {
        return fail(400, withCardNames(hostResult.errors).map((e) => `Host deck: ${e}`))
      }
      const guestResult = validateDeck(
        { faction: guestDeck.faction, cards: guestCards }, infoMap, locked.guest_id, deckRules,
      )
      if (!guestResult.valid) {
        return fail(400, withCardNames(guestResult.errors).map((e) => `Guest deck: ${e}`))
      }

      const built = buildInitialGame({
        gameId: crypto.randomUUID(),
        playerA: locked.host_id,
        playerB: locked.guest_id,
        settings: lockedParsed.settings,
        deckA: { cards: hostCards, snapshots },
        deckB: { cards: guestCards, snapshots },
        factionA: String(hostDeck.faction),
        factionB: String(guestDeck.faction),
        instanceId: () => crypto.randomUUID(),
        rng: secureRng,
      })

      const { data: gameId, error: txError } = await admin.rpc('start_game_tx', {
        p_lobby_id: lobbyId,
        p_game: built.game,
        p_player_a_state: built.aPrivate,
        p_player_b_state: built.bPrivate,
      })
      if (txError) return fail(500, [txError.message])
      return json(200, { gameId })
    } catch (err) {
      // Any unexpected failure after the lock must revert the lobby, or a
      // host's Cancel silently no-ops forever (delete policy only allows
      // open/closed) and the UI has no other recovery path. Conditioned on
      // still being 'starting' so a lobby that already closed via a
      // successful start_game_tx can never be reopened by a late throw.
      await admin.from('lobbies').update({ status: 'open' }).eq('id', lobbyId).eq('status', 'starting')
      return json(500, { errors: [err instanceof Error ? err.message : 'Unexpected error starting game'] })
    }
  }

  return json(400, { errors: [`Unknown action: ${action}`] })
})
