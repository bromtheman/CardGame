import { createClient } from 'npm:@supabase/supabase-js@2'
import { autoKeywords, computeMaterialCost, validateCustomCardInput } from './shared/customCards.ts'
import {
  CARD_IMAGE_MAX_BYTES,
  CARD_IMAGE_MIME_TYPES,
  MAX_CUSTOM_CARDS_PER_PLAYER,
} from './shared/gameSettings.ts'
import type { VehicleType } from './shared/types.ts'

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

  const userId = await verifiedUserId(req, supabaseUrl, anonKey)
  if (!userId) return json(401, { errors: ['Not signed in'] })

  const admin = createClient(supabaseUrl, serviceKey)
  const { count } = await admin
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .eq('is_built_in', false)
  if ((count ?? 0) >= MAX_CUSTOM_CARDS_PER_PLAYER) {
    return json(400, {
      errors: [`Custom card limit reached (${MAX_CUSTOM_CARDS_PER_PLAYER}); delete one first`],
    })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json(400, { errors: ['Body must be multipart form data'] })
  }

  const input = {
    name: String(form.get('name') ?? '').trim(),
    vehicleType: String(form.get('vehicleType') ?? ''),
    blueprintCost: Number(form.get('blueprintCost') ?? NaN),
  }
  const errors = validateCustomCardInput(input)

  const image = form.get('image')
  if (image !== null && !(image instanceof File)) errors.push('image must be a file')
  if (image instanceof File) {
    if (!(CARD_IMAGE_MIME_TYPES as readonly string[]).includes(image.type)) {
      errors.push('Image must be JPEG, PNG, or WebP')
    }
    if (image.size > CARD_IMAGE_MAX_BYTES) errors.push('Image must be under 2 MB')
  }
  if (errors.length > 0) return json(400, { errors })

  let imageUrl = ''
  if (image instanceof File) {
    const ext = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${userId}/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await admin.storage
      .from('card-images')
      .upload(path, image, { contentType: image.type })
    if (uploadError) return json(500, { errors: [`Image upload failed: ${uploadError.message}`] })
    imageUrl = admin.storage.from('card-images').getPublicUrl(path).data.publicUrl
  }

  const vehicleType = input.vehicleType as VehicleType
  const { data: card, error: insertError } = await admin
    .from('cards')
    .insert({
      id: crypto.randomUUID(),
      name: input.name,
      is_built_in: false,
      owner_id: userId,
      faction: 'NEUTRAL',
      type: 'vehicle',
      vehicle_type: vehicleType,
      blueprint_cost: input.blueprintCost,
      material_cost: computeMaterialCost(input.blueprintCost, vehicleType),
      cp_cost: 0,
      card_text: '',
      image_url: imageUrl,
      keywords: autoKeywords(vehicleType),
      meta: {},
    })
    .select()
    .single()
  if (insertError) return json(500, { errors: [insertError.message] })
  return json(201, { card })
})
