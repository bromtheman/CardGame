// The lines `next` holds that `prev` did not (spec §4.3, §6.3). The engine
// caps state.log at LOG_MAX_ENTRIES by dropping the oldest lines, so a plain
// length difference is wrong once a game is long: when the prefix check
// fails, align on the longest prefix of `next` that is a suffix of `prev`.
export function newLogLines(prev: readonly string[], next: readonly string[]): string[] {
  if (next.length >= prev.length && prev.every((line, i) => next[i] === line)) return next.slice(prev.length)
  for (let len = Math.min(prev.length, next.length); len > 0; len--) {
    let match = true
    for (let k = 0; k < len; k++) {
      if (next[k] !== prev[prev.length - len + k]) { match = false; break }
    }
    if (match) return next.slice(len)
  }
  return [...next]
}
