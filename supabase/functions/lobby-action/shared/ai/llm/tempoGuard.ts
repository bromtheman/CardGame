import { TEMPO_GUARD_TURNS } from './llmSettings.ts'
import type { MenuItem } from './moveMenu.ts'

// The tempo guard (2026-09-19 scored menu spec §6.2): the model's pick — an
// item, or null for a pass / END TURN, both worth the position as it stands
// — against the best-scored item on the whole menu. A pick a margin or more
// below the best is replaced by the best, and the row says so.
export interface GuardRecord { picked: number | null; taken: number; gap: number }

export function guardPick(menu: MenuItem[], chosen: MenuItem | null, margin: number = TEMPO_GUARD_TURNS): { item: MenuItem | null; guard: GuardRecord | null } {
  if (!Number.isFinite(margin) || menu.length === 0) return { item: chosen, guard: null }
  const value = (m: MenuItem | null): number => m?.score ?? 0
  const best = menu.reduce((b, m) => (value(m) > value(b) ? m : b), menu[0])
  const gap = Math.round((value(best) - value(chosen)) * 10) / 10
  if (gap < margin || best === chosen) return { item: chosen, guard: null }
  return { item: best, guard: { picked: chosen?.id ?? null, taken: best.id, gap } }
}
