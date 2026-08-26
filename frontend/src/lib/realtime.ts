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
//
// Each connect() uses a unique client-local topic (channelKey + a monotonic
// counter) rather than reusing channelKey directly. supabase.channel(topic)
// returns the SAME channel instance when a channel with that topic is still
// in the client's list, and removeChannel() only closes it once the server
// acks the leave (async) — so a fast reconnect that reused the old topic
// would get back the dying channel, and RealtimeChannel.subscribe() silently
// no-ops unless the channel's adapter state is 'closed'. A unique topic per
// connect attempt sidesteps that dedupe entirely. The topic is purely a
// client-local channel name; the postgres_changes filter below is what
// defines the server-side subscription, so this doesn't change what events
// are received.
let topicSeq = 0

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
        .channel(`${channelKey}#${++topicSeq}`)
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
            // A settled join can follow a phoenix self-rejoin that raced a
            // scheduled backoff retry; clear it so that stale timer doesn't
            // later fire connect() against this now-joined channel (the
            // same dedupe trap the unique topic above avoids).
            if (timer !== undefined) {
              window.clearTimeout(timer)
              timer = undefined
            }
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
