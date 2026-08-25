import { useQuery } from '@tanstack/react-query'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'

export type DeckRow = Database['public']['Tables']['decks']['Row']

export function useDecksQuery() {
  return useQuery({
    queryKey: ['decks'],
    queryFn: async (): Promise<DeckRow[]> => {
      const { data, error } = await supabase.from('decks').select('*').order('updated_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function deckCardCount(deck: DeckRow): number {
  const cards = (deck.cards ?? {}) as Record<string, number>
  return Object.values(cards).reduce((a, b) => a + b, 0)
}
