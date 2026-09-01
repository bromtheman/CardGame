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

import { supabase } from '../../lib/supabaseClient'
import type { FtdPrefill } from './ftdPrefill'

/**
 * How often the overlay asks whether the mod has reported yet.
 *
 * Polled rather than pushed: `battle_tokens` is not in the realtime publication
 * and has no RLS policy (the migration explains why — its rows are one
 * player's live token hashes), so the `useRealtimeInvalidate` route the rest of
 * the board uses is not open to it. A battle overlay is short-lived and open on
 * at most two browsers, so this is a handful of requests per fight.
 */
export const FTD_RESULT_POLL_MS = 15_000

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

/** Whatever the mod has reported for the battle currently under way, or null. */
export function useFtdResultQuery(gameId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['ftdResult', gameId],
    enabled: !!gameId && enabled,
    refetchInterval: FTD_RESULT_POLL_MS,
    queryFn: async (): Promise<FtdPrefill | null> => {
      const data = await invoke<{ result: FtdPrefill | null }>({ op: 'fetch', gameId: gameId! })
      return data.result ?? null
    },
  })
}
