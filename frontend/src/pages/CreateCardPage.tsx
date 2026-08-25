import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { CARD_IMAGE_MAX_BYTES, CARD_IMAGE_MIME_TYPES, VEHICLE_TYPES } from '@shared/gameSettings'
import { autoKeywords, computeMaterialCost, validateCustomCardInput } from '@shared/customCards'
import type { VehicleType } from '@shared/types'
import { PhysicalCard } from '../components/PhysicalCard'
import type { CardRow } from '../lib/cards'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'

export function CreateCardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const [name, setName] = useState('')
  const [vehicleType, setVehicleType] = useState<VehicleType>('ship')
  const [blueprintCost, setBlueprintCost] = useState(50000)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => {
    if (!imageFile) { setPreviewUrl(''); return }
    const url = URL.createObjectURL(imageFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const inputErrors = validateCustomCardInput({ name, vehicleType, blueprintCost })
  const preview = useMemo<CardRow>(() => ({
    id: 'preview', name: name || 'Unnamed', is_built_in: false, owner_id: session?.user.id ?? null,
    faction: 'NEUTRAL', type: 'vehicle', vehicle_type: vehicleType,
    blueprint_cost: blueprintCost,
    material_cost: inputErrors.length === 0 ? computeMaterialCost(blueprintCost, vehicleType) : 0,
    cp_cost: 0, card_text: '', image_url: previewUrl,
    keywords: autoKeywords(vehicleType) as CardRow['keywords'], meta: {}, created_at: '',
  }), [name, vehicleType, blueprintCost, previewUrl, inputErrors.length, session])

  function onPickFile(f: File | null) {
    if (!f) return setImageFile(null)
    if (!(CARD_IMAGE_MIME_TYPES as readonly string[]).includes(f.type)) {
      setErrors(['Image must be JPEG, PNG, or WebP']); return
    }
    if (f.size > CARD_IMAGE_MAX_BYTES) {
      setErrors([`Image must be under ${Math.round(CARD_IMAGE_MAX_BYTES / 1024 / 1024)} MB`]); return
    }
    setErrors([]); setImageFile(f)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (inputErrors.length > 0) { setErrors(inputErrors); return }
    setBusy(true); setErrors([])
    try {
      const form = new FormData()
      form.append('name', name.trim())
      form.append('vehicleType', vehicleType)
      form.append('blueprintCost', String(blueprintCost))
      if (imageFile) form.append('image', imageFile)
      const { error } = await supabase.functions.invoke('create-card', { body: form })
      if (error) {
        // supabase-js wraps non-2xx responses; the function's {errors} body
        // is only reachable through error.context.
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => null)
          if (body?.errors) { setErrors(body.errors); return }
        }
        throw error
      }
      await queryClient.invalidateQueries({ queryKey: ['cards'] })
      navigate('/cards')
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-wrap justify-center gap-10 p-6">
      <form onSubmit={onSubmit} className="flex w-80 flex-col gap-3">
        <h1 className="font-display text-3xl">Design a vehicle</h1>
        <input className="rounded bg-ocean-900 p-2" placeholder="Vehicle name" value={name}
          onChange={(e) => setName(e.target.value)} />
        <select className="rounded bg-ocean-900 p-2" value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value as VehicleType)}>
          {Object.values(VEHICLE_TYPES).map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <label className="text-sm text-ocean-300">
          Blueprint cost (from FTD)
          <input type="number" className="mt-1 w-full rounded bg-ocean-900 p-2" value={blueprintCost}
            onChange={(e) => setBlueprintCost(Number(e.target.value))} />
        </label>
        <label className="text-sm text-ocean-300">
          Card image (optional, 2 MB max)
          <input type="file" accept={CARD_IMAGE_MIME_TYPES.join(',')} className="mt-1 w-full"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
        </label>
        {vehicleType === 'plane' && (
          <p className="text-sm text-ocean-300">Planes cost half materials but are Temporary.</p>
        )}
        {errors.map((err) => <p key={err} className="text-red-400">{err}</p>)}
        <button disabled={busy || inputErrors.length > 0}
          className="rounded bg-brass-400 p-2 font-bold text-ocean-950 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create card'}
        </button>
      </form>
      <div>
        <p className="mb-2 text-center text-sm text-ocean-300">Preview</p>
        <PhysicalCard card={preview} />
      </div>
    </main>
  )
}
