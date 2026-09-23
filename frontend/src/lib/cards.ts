import { useQuery } from '@tanstack/react-query'
import type { SnapshotCard } from '@shared/engine/gameInit'
import { VEHICLE_TYPES } from '@shared/gameSettings'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'
import shipArt from '../assets/icons/shipSVG.svg'
import submarineArt from '../assets/icons/submarineSVG.svg'
import tankArt from '../assets/icons/tankSVG.svg'
import planeArt from '../assets/icons/planeSVG.svg'
import airshipArt from '../assets/icons/airShield1SVG.svg'
import hoverArt from '../assets/icons/hovercraftSVG.svg'
import anchorArt from '../assets/icons/anchorSVG.svg'

export type CardRow = Database['public']['Tables']['cards']['Row']

export function useCardsQuery() {
  return useQuery({
    queryKey: ['cards'],
    queryFn: async (): Promise<CardRow[]> => {
      const { data, error } = await supabase.from('cards').select('*').order('material_cost')
      if (error) throw error
      return data
    },
    staleTime: 5 * 60 * 1000,
  })
}

// The picture for a card with no hosted art: a faded silhouette of its vehicle
// type, or the anchor for an ability. Not the gold vehicleTypeIcon — the owner
// kept these silhouettes as card pictures when the icons went gold (2026-09-22).
// Every VEHICLE_TYPES value needs an entry: a missing one falls back to the
// anchor silently (cards.test.ts holds every type to it).
const PLACEHOLDER_ART: Record<string, string> = {
  [VEHICLE_TYPES.SHIP]: shipArt,
  // The hovercraft amendment's silhouette (2026-09-22 §4) is the card picture;
  // its brass emblem, icons/vehicles/hovercraft.svg, is the glossary icon.
  [VEHICLE_TYPES.HOVER]: hoverArt,
  [VEHICLE_TYPES.SUB]: submarineArt,
  [VEHICLE_TYPES.TANK]: tankArt,
  [VEHICLE_TYPES.PLANE]: planeArt,
  [VEHICLE_TYPES.AIRSHIP]: airshipArt,
}

// Built-in image_urls are bare filenames with no hosted art; only real URLs
// render (blob: covers the create-card local preview).
export function cardImageOrFallback(card: CardRow): { src: string; isFallback: boolean } {
  if (card.image_url.startsWith('http') || card.image_url.startsWith('blob:')) {
    return { src: card.image_url, isFallback: false }
  }
  return { src: PLACEHOLDER_ART[card.vehicle_type ?? ''] ?? anchorArt, isFallback: true }
}

// A card in play/in hand carries the same fields as a `cards` row under
// engine-side names; the card UI speaks CardRow, so adapt at the boundary.
// `created_at` is unused by the card UI and has no engine counterpart.
export function cardInstanceToRow(c: SnapshotCard & { instanceId?: string }): CardRow {
  return {
    id: c.instanceId ?? c.cardId, name: c.name, is_built_in: c.isBuiltIn, owner_id: c.ownerId,
    faction: c.faction, type: c.type, vehicle_type: c.vehicleType,
    blueprint_cost: c.blueprintCost, material_cost: c.materialCost, cp_cost: c.cpCost,
    card_text: c.cardText, image_url: c.imageUrl,
    keywords: c.keywords, meta: c.meta, created_at: '',
  } as CardRow
}
