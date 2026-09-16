// The network half of the From The Depths reporting handshake.
//
// Split from `ftdPrefill.ts` deliberately: this module imports
// `supabaseClient`, which throws at import time when VITE_SUPABASE_URL /
// VITE_SUPABASE_PUBLISHABLE_KEY are absent — and the root vitest config has no
// `envDir`, so any test that reaches this file transitively must vi.mock it
// (docs/claude/testing.md). Keeping the logic worth testing on the other side
// of that line means no mock is needed to test it.
import { useQuery } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { FTD_RESULT_EVENT, ftdResultTopic } from '@shared/battleReport'

import { useBroadcastInvalidate } from '../../lib/realtime'
import { supabase } from '../../lib/supabaseClient'
import type { FtdPrefill } from './ftdPrefill'

/**
 * How often the overlay re-asks whether the mod has reported, as a FALLBACK.
 *
 * The result is pushed: when the mod's `submit` lands, a trigger on
 * `battle_tokens` broadcasts `FTD_RESULT_EVENT` on the game's private topic
 * and `useFtdResultBroadcast` below refetches at once (see the
 * `*_ftd_result_broadcast.sql` migration). `battle_tokens` itself stays out of
 * the realtime publication with no RLS policy — its rows are one player's live
 * token hashes — which is why this is a broadcast and not the postgres_changes
 * route the rest of the board uses.
 *
 * The poll remains for the case the push cannot cover: a channel that never
 * recovers, or `realtime.send` failing (it logs a warning rather than failing
 * the redeem). Slow enough to be cheap, fast enough that the feature still
 * works, just slower, with realtime down.
 */
export const FTD_RESULT_POLL_MS = 30_000

// Same error contract every other call site here uses: FunctionsHttpError ->
// the function's own `{ errors: string[] }` body -> one readable sentence.
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('battle-report', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const parsed = await error.context.json().catch(() => null)
      throw new Error(parsed?.errors?.join('; ') ?? error.message)
    }
    throw new Error(error.message)
  }
  return data as T
}

export interface IssuedBattleToken {
  version: number
  token: string
  endpoint: string
  gameId: string
  zoneId: number
  battleKey: string
  side: string
}

/**
 * Mint the single-use token that goes into the battle file.
 *
 * Called at download time rather than at battle declaration, so exactly one
 * live token exists per player per game and re-downloading retires the last
 * one. The token authorises one call to `battle-report`'s `submit` op — it can
 * prefill a report and nothing else.
 */
export function issueBattleToken(gameId: string): Promise<IssuedBattleToken> {
  return invoke<IssuedBattleToken>({ op: 'issue', gameId })
}

const ftdResultKey = (gameId: string | undefined) => ['ftdResult', gameId]

/** Whatever the mod has reported for the battle currently under way, or null. */
export function useFtdResultQuery(gameId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ftdResultKey(gameId),
    enabled: !!gameId && enabled,
    refetchInterval: FTD_RESULT_POLL_MS,
    queryFn: async (): Promise<FtdPrefill | null> => {
      const data = await invoke<{ result: FtdPrefill | null }>({ op: 'fetch', gameId: gameId! })
      return data.result ?? null
    },
  })
}

/**
 * The push half of `useFtdResultQuery`: joins the game's private result topic
 * while `enabled` and refetches the query the moment the mod's report lands.
 * Only participants can join (the `realtime.messages` policy), and the event
 * carries nothing worth reading — `fetch` is still where the numbers come from.
 */
export function useFtdResultBroadcast(gameId: string | undefined, enabled: boolean) {
  useBroadcastInvalidate(
    gameId && enabled ? ftdResultTopic(gameId) : null,
    FTD_RESULT_EVENT,
    [ftdResultKey(gameId)],
  )
}
