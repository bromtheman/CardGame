import { useQuery } from '@tanstack/react-query'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'

import shipIcon from '../assets/icons/shipSVG.svg'
import planeIcon from '../assets/icons/planeSVG.svg'
import subIcon from '../assets/icons/submarineSVG.svg'
import tankIcon from '../assets/icons/tankSVG.svg'
import airshipIcon from '../assets/icons/airShield1SVG.svg'
import anchorIcon from '../assets/icons/anchorSVG.svg'

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

const FALLBACKS: Record<string, string> = {
  ship: shipIcon, plane: planeIcon, sub: subIcon, tank: tankIcon, airship: airshipIcon,
}

// Built-in image_urls are bare filenames with no hosted art; only real URLs
// render (blob: covers the create-card local preview).
export function cardImageOrFallback(card: CardRow): { src: string; isFallback: boolean } {
  if (card.image_url.startsWith('http') || card.image_url.startsWith('blob:')) {
    return { src: card.image_url, isFallback: false }
  }
  return { src: FALLBACKS[card.vehicle_type ?? ''] ?? anchorIcon, isFallback: true }
}
