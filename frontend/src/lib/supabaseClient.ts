import { FunctionRegion, createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Where every `functions.invoke` runs: the project's database region.
 *
 * By default an edge function executes nearest the caller, and each of its
 * sequential database/auth round trips then crosses to wherever the database
 * is — for a US-East player against this us-west-2 project, three to six
 * cross-country hops per call (measured 2026-09-16: battle-report p50 622 ms,
 * game-action p50 929 ms). Pinning trades one longer browser→function hop for
 * N short ones. Pass it on every invoke; supabase-js has no client-wide
 * setting for it. Its twin for the mod's POST is the `forceFunctionRegion`
 * parameter `battle-report`'s `issue` writes into the minted endpoint.
 *
 * The option sends an `x-region` header, which every function's CORS block
 * must allow — deploy the functions before shipping a change here.
 */
export const FUNCTIONS_REGION = FunctionRegion.UsWest2

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY — copy frontend/.env.example to frontend/.env.local and fill in the values.',
  )
}

export const supabase = createClient<Database>(url, key)
