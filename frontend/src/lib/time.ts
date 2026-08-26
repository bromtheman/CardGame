// Coarse "how long ago" label for game rows — no seconds precision, just
// enough to tell a stale game from a live one at a glance.
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const deltaMs = nowMs - new Date(iso).getTime()
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(seconds / 3600)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(seconds / 86400)
  return `${days}d ago`
}
