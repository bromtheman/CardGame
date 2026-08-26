import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { actionForStatus, backoffDelayMs, wakeAction } from './reconnectPolicy'

// Subscribes to postgres_changes and invalidates the given query keys on any
// event. Self-healing (spec §6: reconnect = resubscribe + refetch): channel
// errors trigger backoff resubscribes, a (re)join refetches to catch missed
// events, and waking the tab (online / visible) checks the channel and
// refetches. Each connect attempt carries a generation token so callbacks
// from a superseded channel (removeChannel fires its CLOSED) are ignored.
export function useRealtimeInvalidate(
  channelKey: string,
  table: string,
  queryKeys: unknown[][],
  filter?: string,
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    let disposed = false
    let generation = 0
    let attempt = 0
    let timer: number | undefined
    let channel: RealtimeChannel | null = null

    const invalidateAll = () => {
      for (const key of queryKeys) queryClient.invalidateQueries({ queryKey: key })
    }

    const connect = () => {
      if (disposed) return
      // An out-of-band reconnect (wake) supersedes any scheduled retry.
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
      const mine = ++generation
      if (channel) supabase.removeChannel(channel)
      channel = supabase
        .channel(channelKey)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
          invalidateAll,
        )
        .subscribe((status) => {
          if (disposed || mine !== generation) return
          const action = actionForStatus(status)
          if (action === 'settled') {
            attempt = 0
            invalidateAll()
          } else if (action === 'reconnect' && timer === undefined) {
            timer = window.setTimeout(() => {
              timer = undefined
              connect()
            }, backoffDelayMs(attempt++))
          }
        })
    }

    const onWake = () => {
      if (disposed || document.visibilityState === 'hidden') return
      if (wakeAction(channel?.state ?? 'closed') === 'reconnect') connect()
      else invalidateAll()
    }

    connect()
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
      if (channel) supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey, table, filter, queryClient])
}
