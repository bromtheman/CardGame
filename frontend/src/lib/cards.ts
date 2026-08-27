import { useQuery } from '@tanstack/react-query'
import type { SnapshotCard } from '@shared/engine/gameInit'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'
import { vehicleTypeIcon } from './keywords'

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

// Built-in image_urls are bare filenames with no hosted art; only real URLs
// render (blob: covers the create-card local preview).
export function cardImageOrFallback(card: CardRow): { src: string; isFallback: boolean } {
  if (card.image_url.startsWith('http') || card.image_url.startsWith('blob:')) {
    return { src: card.image_url, isFallback: false }
  }
  return { src: vehicleTypeIcon(card.vehicle_type), isFallback: true }
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
