import type { Side } from '../engine/engineTypes.ts'

// The one auth user PracticeAI signs in as never — it has no session. Its
// profile row carries is_bot = true (migration 20260916210000_ai_opponent);
// lobby-action finds it by that flag, never by this name (spec §3.1).
export const BOT_USERNAME = 'PracticeAI'

// The frozen settings key START stamps on a practice game (spec §4.3). Read
// it only through botSideOf — the materialsPerTurnOf shape — so a row without
// the key, which is every human game, reads as a human game everywhere.
// validateLobbySettings rebuilds its result from known keys, so a client can
// never smuggle this in; START is its only writer.
export function botSideOf(settings: unknown): Side | null {
  const bot = (settings as { bot?: unknown } | null | undefined)?.bot
  if (!bot || typeof bot !== 'object') return null
  const side = (bot as { side?: unknown }).side
  return side === 'a' || side === 'b' ? side : null
}

export function botPlayerId(
  game: { playerA: string; playerB: string; settings: unknown },
): string | null {
  const side = botSideOf(game.settings)
  if (side === null) return null
  return side === 'a' ? game.playerA : game.playerB
}
