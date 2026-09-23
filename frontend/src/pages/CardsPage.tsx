import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PhysicalCard } from '../components/PhysicalCard'
import { catalogueCards, catalogueTab } from '../lib/cardCatalogue'
import { useCardsQuery } from '../lib/cards'

export function CardsPage() {
  const { data: cards, isLoading, error } = useCardsQuery()
  const factions = useMemo(
    () => [...new Set((cards ?? []).filter((c) => c.is_built_in).map((c) => c.faction))].sort(),
    [cards],
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const active = catalogueTab(searchParams.get('faction'), factions)
  // Replace, not push: Back leaves the page instead of replaying tab clicks.
  const selectTab = (f: string) => setSearchParams({ faction: f }, { replace: true })

  if (isLoading) return <main className="p-8 text-center">Loading cards…</main>
  if (error) return <main className="p-8 text-center text-red-400">Failed to load cards: {String(error)}</main>

  const shown = catalogueCards(cards ?? [], active)
  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="flex flex-wrap items-center gap-2">
        {[...factions, 'CUSTOM'].map((f) => (
          <button
            key={f}
            onClick={() => selectTab(f)}
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
