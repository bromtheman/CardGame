import { createClient } from 'npm:@supabase/supabase-js@2'
import { autoKeywords, computeMaterialCost, validateCustomCardInput } from './shared/customCards.ts'
import {
  CARD_IMAGE_MAX_BYTES,
  CARD_IMAGE_MIME_TYPES,
  MAX_CUSTOM_CARDS_PER_PLAYER,
} from './shared/gameSettings.ts'
import type { VehicleType } from './shared/types.ts'

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
