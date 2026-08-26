// Pure decisions for the realtime reconnect loop — kept free of supabase and
// React so they can be unit-tested (the hook in realtime.ts is the only I/O).
export const BACKOFF_BASE_MS = 1000
export const BACKOFF_CAP_MS = 30_000

export function backoffDelayMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS)
}

export function actionForStatus(status: string): 'settled' | 'reconnect' | 'ignore' {
  if (status === 'SUBSCRIBED') return 'settled'
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') return 'reconnect'
  return 'ignore'
}

// After the tab wakes (online / visibilitychange): a joined channel only
// needs a catch-up refetch; anything else needs a fresh subscription.
export function wakeAction(channelState: string): 'reconnect' | 'refetch' {
  return channelState === 'joined' ? 'refetch' : 'reconnect'
}
