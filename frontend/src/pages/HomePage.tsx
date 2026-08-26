import { Link } from 'react-router-dom'
import { isMyMove, useGamesQuery } from '../lib/games'
import { useAuth } from '../lib/auth'

const quickLinks = [
  { to: '/lobbies', label: 'Harbor' },
  { to: '/games', label: 'My Games' },
  { to: '/decks', label: 'Decks' },
  { to: '/cards', label: 'Cards' },
]

export function HomePage() {
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const { data: games, isLoading } = useGamesQuery()
  const awaiting = (games ?? []).filter(
    (g) => g.status === 'active' && isMyMove(g as unknown as Parameters<typeof isMyMove>[0], me),
  )

  return (
    <main className="mx-auto max-w-3xl p-8 text-center">
      <h1 className="font-display text-4xl">Welcome, Captain</h1>
      <p className="mt-4 text-ocean-300">
        Build a fleet, claim the zones, and settle it in From The Depths.
      </p>

      {!isLoading && awaiting.length > 0 && (
        <Link
          to="/games"
          className="mt-6 block rounded border border-brass-400 bg-ocean-900/60 p-3 font-bold text-brass-400 shadow-plank"
        >
          {awaiting.length} battle{awaiting.length === 1 ? '' : 's'} await your orders
        </Link>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4">
        {quickLinks.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="rounded border border-ocean-600 bg-ocean-900/60 p-6 font-display text-xl text-parchment-100 shadow-plank hover:border-brass-400 hover:text-brass-400"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </main>
  )
}
