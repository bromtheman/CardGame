import { useQuery } from '@tanstack/react-query'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'

export type GameRow = Database['public']['Tables']['games']['Row']
export type GamePlayerRow = Database['public']['Tables']['game_players']['Row']

export function useGamesQuery() {
  return useQuery({
    queryKey: ['games'],
    queryFn: async (): Promise<GameRow[]> => {
      const { data, error } = await supabase
        .from('games').select('*').order('updated_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useGameQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['game', id],
    enabled: !!id,
    queryFn: async (): Promise<GameRow | null> => {
      const { data, error } = await supabase
        .from('games').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useMyGamePlayerQuery(gameId: string | undefined) {
  return useQuery({
    queryKey: ['gamePlayer', gameId],
    enabled: !!gameId,
    queryFn: async (): Promise<GamePlayerRow | null> => {
      const { data, error } = await supabase
        .from('game_players').select('*').eq('game_id', gameId!).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useUsernames(ids: (string | null | undefined)[]) {
  const clean = [...new Set(ids.filter((x): x is string => !!x))].sort()
  return useQuery({
    queryKey: ['usernames', clean],
    enabled: clean.length > 0,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from('profiles').select('id, username').in('id', clean)
      if (error) throw error
      return new Map(data.map((p) => [p.id, p.username]))
    },
  })
}
