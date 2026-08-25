import { Link } from 'react-router-dom'
import { useGamesQuery, useUsernames } from '../lib/games'
import { useRealtimeInvalidate } from '../lib/realtime'
import { useAuth } from '../lib/auth'

export function GamesPage() {
  const { session } = useAuth()
  const { data: games, isLoading, error } = useGamesQuery()
  const me = session?.user.id
  const { data: names } = useUsernames(
    (games ?? []).flatMap((g) => [g.player_a, g.player_b]),
  )
  useRealtimeInvalidate('games-list', 'games', [['games']])

  if (isLoading) return <main className="p-8 text-center">Loading games…</main>
  if (error) return <main className="p-8 text-center text-red-400">Failed to load games: {String(error)}</main>

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl">Your battles</h1>
      <ul className="mt-4 flex flex-col gap-3">
        {(games ?? []).map((g) => {
          const opponent = g.player_a === me ? g.player_b : g.player_a
          return (
            <li key={g.id}>
              <Link to={`/game/${g.id}`}
                className="flex items-center gap-4 rounded border border-ocean-600 bg-ocean-900/60 p-4">
                <span className="flex-1">
                  vs <span className="font-bold">{names?.get(opponent) ?? '…'}</span>
                </span>
                <span className="text-ocean-300">turn {String(g.turn_number)}</span>
                <span className="text-ocean-300">{g.status}</span>
                {g.status === 'active' && g.active_player === me && (
                  <span className="rounded bg-brass-400 px-2 py-0.5 text-sm font-bold text-ocean-950">
                    Your turn
                  </span>
                )}
              </Link>
            </li>
          )
        })}
        {(games ?? []).length === 0 && <p className="text-ocean-300">No battles yet — visit the Harbor.</p>}
      </ul>
    </main>
  )
}
