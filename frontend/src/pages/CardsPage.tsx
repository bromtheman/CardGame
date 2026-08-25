import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PhysicalCard } from '../components/PhysicalCard'
import { useCardsQuery } from '../lib/cards'

export function CardsPage() {
  const { data: cards, isLoading, error } = useCardsQuery()
  const factions = useMemo(
    () => [...new Set((cards ?? []).filter((c) => c.is_built_in).map((c) => c.faction))].sort(),
    [cards],
  )
  const [tab, setTab] = useState<string | null>(null)
  const active = tab ?? factions[0] ?? null

  if (isLoading) return <main className="p-8 text-center">Loading cards…</main>
  if (error) return <main className="p-8 text-center text-red-400">Failed to load cards: {String(error)}</main>

  const shown = (cards ?? []).filter((c) =>
    active === 'CUSTOM' ? !c.is_built_in : c.is_built_in && c.faction === active,
  )
  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="flex flex-wrap items-center gap-2">
        {[...factions, 'CUSTOM'].map((f) => (
          <button
            key={f}
            onClick={() => setTab(f)}
            className={`rounded px-3 py-1 font-bold ${active === f ? 'bg-brass-400 text-ocean-950' : 'bg-ocean-900 text-parchment-100'}`}
          >
            {f}
          </button>
        ))}
        <Link to="/cards/new" className="ml-auto rounded bg-brass-400 px-3 py-1 font-bold text-ocean-950">
          + Create custom card
        </Link>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-6">
        {shown.map((c) => <PhysicalCard key={c.id} card={c} />)}
        {shown.length === 0 && <p className="text-ocean-300">No cards here yet.</p>}
      </div>
    </main>
  )
}
