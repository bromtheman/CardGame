import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { actionForStatus, backoffDelayMs, wakeAction } from './reconnectPolicy'

// Two kinds of subscription share one self-healing loop below (spec §6:
// reconnect = resubscribe + refetch): channel errors trigger backoff
// resubscribes, a (re)join refetches to catch missed events, and waking the
// tab (online / visible) checks the channel and refetches. Each connect
// attempt carries a generation token so callbacks from a superseded channel
// (removeChannel fires its CLOSED) are ignored.
//
// They differ in what a topic MEANS, and that difference decides how a
// reconnect may replace the channel:
//
//   * postgres_changes — the topic is a client-local label; the filter below
//     defines the server-side subscription. Each connect() uses a unique topic
//     (channelKey + a monotonic counter) rather than reusing channelKey
//     directly. supabase.channel(topic) returns the SAME channel instance when
//     a channel with that topic is still in the client's list, and
//     removeChannel() only closes it once the server acks the leave (async) —
//     so a fast reconnect that reused the old topic would get back the dying
//     channel, and RealtimeChannel.subscribe() silently no-ops unless the
//     channel's adapter state is 'closed'. A unique topic per connect attempt
//     sidesteps that dedupe entirely.
//   * broadcast — the topic IS the subscription (`game:<id>:ftd`), so it must
//     be reused exactly, and the channel is private: the server checks the
//     joining user against the `realtime.messages` policies. Here the dedupe
//     cannot be sidestepped, so a reconnect AWAITS the old channel's leave
//     before opening the new one. That wait matters for a second reason:
//     RealtimeClient._remove drops every channel whose topic matches the one
//     closing, so a same-topic channel created while the old one is still
//     leaving is silently orphaned when that close finally lands.
type ChannelSpec =
  | { kind: 'postgres_changes'; channelKey: string; table: string; filter?: string }
  | { kind: 'broadcast'; topic: string; event: string }

let topicSeq = 0

function openChannel(spec: ChannelSpec, onEvent: () => void): RealtimeChannel {
  if (spec.kind === 'postgres_changes') {
    return supabase
      .channel(`${spec.channelKey}#${++topicSeq}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: spec.table, ...(spec.filter ? { filter: spec.filter } : {}) },
        onEvent,
      )
  }
  return supabase
    .channel(spec.topic, { config: { private: true } })
    .on('broadcast', { event: spec.event }, onEvent)
}

/** Subscribes to postgres_changes on `table` and invalidates `queryKeys` on any event. */
export function useRealtimeInvalidate(
  channelKey: string,
  table: string,
  queryKeys: unknown[][],
  filter?: string,
) {
  useChannelInvalidate({ kind: 'postgres_changes', channelKey, table, filter }, queryKeys)
}

/**
 * Joins the private broadcast `topic` and invalidates `queryKeys` whenever
 * `event` arrives. `null` means "not now" (the subscription is dropped), so a
 * caller can gate it on a condition without breaking the rules of hooks.
 *
 * The event's payload is deliberately ignored: a broadcast is a wake-up, and
 * the query it invalidates is the source of truth.
 */
export function useBroadcastInvalidate(
  topic: string | null,
  event: string,
  queryKeys: unknown[][],
) {
  useChannelInvalidate(topic === null ? null : { kind: 'broadcast', topic, event }, queryKeys)
}

function useChannelInvalidate(spec: ChannelSpec | null, queryKeys: unknown[][]) {
  const queryClient = useQueryClient()
  // The effect keys on the spec's content, not its identity — call sites build
  // a fresh object every render.
  const specKey = spec === null ? '' : JSON.stringify(spec)
  useEffect(() => {
    if (spec === null) return
    let disposed = false
    let generation = 0
    let attempt = 0
    let timer: number | undefined
    let channel: RealtimeChannel | null = null
    // Broadcast only: every replaced channel's leave, in order, so two
    // overlapping connect() calls (a wake racing a backoff retry) both wait
    // for the same topic to be genuinely free before either opens it.
    let leaving: Promise<unknown> = Promise.resolve()

    const invalidateAll = () => {
      for (const key of queryKeys) queryClient.invalidateQueries({ queryKey: key })
    }

    const connect = async () => {
      if (disposed) return
      // An out-of-band reconnect (wake) supersedes any scheduled retry.
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
      const mine = ++generation
      const previous = channel
      channel = null
      if (previous) {
        if (spec.kind === 'broadcast') {
          leaving = leaving.then(() => supabase.removeChannel(previous))
          await leaving
          if (disposed || mine !== generation) return
        } else {
          supabase.removeChannel(previous)
        }
      }
      channel = openChannel(spec, invalidateAll).subscribe((status) => {
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
            void connect()
          }, backoffDelayMs(attempt++))
        }
      })
    }

    const onWake = () => {
      if (disposed || document.visibilityState === 'hidden') return
      if (wakeAction(channel?.state ?? 'closed') === 'reconnect') void connect()
      else invalidateAll()
    }

    void connect()
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
  }, [specKey, queryClient])
}
