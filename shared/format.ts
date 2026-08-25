export function shortHandNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`
  if (n >= 1_000) {
    const k = n / 1_000
    return Number.isInteger(k) ? `${k}k` : `${parseFloat(k.toFixed(1))}k`
  }
  return String(n)
}
