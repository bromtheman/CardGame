import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient'

// Subscribes to postgres_changes on one table and invalidates the given
// query keys on any event. Payloads are treated as change signals only —
// consumers refetch through their queries.
export function useRealtimeInvalidate(
  channelKey: string,
  table: string,
  queryKeys: unknown[][],
  filter?: string,
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = supabase
      .channel(channelKey)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => {
          for (const key of queryKeys) queryClient.invalidateQueries({ queryKey: key })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, table, filter, queryClient])
}
