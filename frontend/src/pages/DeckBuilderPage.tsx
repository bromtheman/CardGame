import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FACTIONS } from '@shared/gameSettings'
import type { DeckCardInfo } from '@shared/engine/deckValidation'
import { validateDeck } from '@shared/engine/deckValidation'
import { shortHandNumber } from '@shared/format'
import { CopyStepper } from '../components/CopyStepper'
import { PhysicalCard } from '../components/PhysicalCard'
import { useCardsQuery } from '../lib/cards'
import { useDecksQuery } from '../lib/decks'
import { MAX_COPIES_PER_CARD, setDeckCopies } from '../lib/deckEditing'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'

export function DeckBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const { data: allCards } = useCardsQuery()
  const { data: decks, isLoading: decksLoading, error: decksError } = useDecksQuery()
  const deck = decks?.find((d) => d.id === id)

  const [cards, setCards] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Reset local edits only when a DIFFERENT deck loads — keying on the row
  // object would clobber in-progress edits when a save's refetch returns a
  // new object identity (updated_at changes).
  useEffect(() => {
    if (deck) {
      setCards((deck.cards ?? {}) as Record<string, number>)
      setName(deck.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck?.id])

  const { data: heroPowers } = useQuery({
    queryKey: ['heroPowers', deck?.faction],
    enabled: !!deck,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hero_powers').select('*')
        .in('faction', [FACTIONS.NEUTRAL, deck!.faction])
      if (error) throw error
      return data
    },
  })

  const pool = useMemo(
    () =>
      (allCards ?? []).filter((c) =>
        (c.meta as { summonOnly?: boolean } | null)?.summonOnly === true
          ? false
          : c.is_built_in
            ? c.faction === deck?.faction || c.faction === FACTIONS.NEUTRAL
            : c.owner_id === session?.user.id,
      ),
    [allCards, deck, session],
  )

  const validation = useMemo(() => {
    if (!deck || !allCards || !session) return null
    const infoMap = new Map<string, DeckCardInfo>(
      allCards.map((c) => [c.id, {
        id: c.id, isBuiltIn: c.is_built_in, faction: c.faction,
        vehicleType: c.vehicle_type, ownerId: c.owner_id,
        summonOnly: (c.meta as { summonOnly?: boolean } | null)?.summonOnly === true,
      }]),
    )
    return validateDeck({ faction: deck.faction, cards }, infoMap, session.user.id)
  }, [deck, allCards, session, cards])

  // Stepping off `prev` rather than off a rendered quantity keeps two clicks
  // batched into one render from both resolving to the same target.
  function stepCopies(cardId: string, delta: number) {
    setCards((prev) => setDeckCopies(prev, cardId, (prev[cardId] ?? 0) + delta))
    setSaveState('idle')
  }

  async function onSave() {
    if (!deck) return
    setSaveState('saving'); setSaveError(null)
    const { error } = await supabase.from('decks')
      .update({ name: name.trim() || deck.name, cards })
      .eq('id', deck.id)
    if (error) { setSaveState('error'); setSaveError(error.message); return }
    await queryClient.invalidateQueries({ queryKey: ['decks'] })
    setSaveState('saved')
  }

  if (decksLoading) return <main className="p-8 text-center">Loading deck…</main>
  if (decksError) {
    return <main className="p-8 text-center text-red-400">Failed to load deck: {String(decksError)}</main>
  }
  if (!deck) {
    return (
      <main className="p-8 text-center">
        <p>That deck doesn't exist (or isn't yours).</p>
        <Link className="underline" to="/decks">Back to your fleets</Link>
      </main>
    )
  }

  const cardById = new Map((allCards ?? []).map((c) => [c.id, c]))
  const inDeck = Object.entries(cards)
  return (
    <main className="mx-auto flex max-w-[1600px] flex-wrap gap-6 p-6">
      <section className="min-w-[600px] flex-1">
        <h1 className="font-display text-2xl">{deck.faction} card pool</h1>
        <p className="text-sm text-ocean-300">
          Press a card to read it; use the stepper in its corner to put up to{' '}
          {MAX_COPIES_PER_CARD} copies in the deck.
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          {pool.map((c) => (
            <div key={c.id} className="scale-90 origin-top-left">
              <PhysicalCard
                card={c}
                footer={
                  <CopyStepper
                    copies={cards[c.id] ?? 0}
                    max={MAX_COPIES_PER_CARD}
                    onStep={(delta) => stepCopies(c.id, delta)}
                    label={`Copies of ${c.name} in this deck`}
                    className="border-ocean-600 bg-parchment-300 px-1.5 py-1 text-xl text-ocean-950"
                  />
                }
              />
            </div>
          ))}
        </div>
      </section>
      <aside className="w-96">
        <input className="w-full rounded bg-ocean-900 p-2 font-display text-xl" value={name}
          onChange={(e) => { setName(e.target.value); setSaveState('idle') }} />
        <ul className="mt-3 flex flex-col gap-1">
          {inDeck.map(([cardId, qty]) => {
            const c = cardById.get(cardId)
            return (
              <li key={cardId} className="flex items-center gap-2 rounded bg-ocean-900/60 px-2 py-1">
                <span className="flex-1 truncate">{c?.name ?? cardId}</span>
                <span className="text-ocean-300">{c ? shortHandNumber(c.material_cost) : ''}</span>
                <CopyStepper
                  copies={qty}
                  max={MAX_COPIES_PER_CARD}
                  onStep={(delta) => stepCopies(cardId, delta)}
                  label={`Copies of ${c?.name ?? cardId} in this deck`}
                  className="px-1"
                />
              </li>
            )
          })}
          {inDeck.length === 0 && (
            <li className="rounded bg-ocean-900/60 px-2 py-1 text-ocean-300">No cards yet.</li>
          )}
        </ul>
        {/* Deck status sits directly above Save rather than above the list:
            errors appear and disappear on every quantity change, and from up
            there each one shoved the whole card list down under the cursor. */}
        {validation && (
          <div className={`mt-3 rounded p-3 ${validation.valid ? 'bg-green-900/60' : 'bg-ocean-900/80'}`}>
            <p className="font-bold">{validation.cardCount} cards — {validation.valid ? 'battle ready' : 'draft'}</p>
            <ul className="mt-1 list-inside list-disc text-sm text-ocean-300">
              {validation.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}
        <button onClick={onSave} disabled={saveState === 'saving'}
          className="mt-4 w-full rounded bg-brass-400 p-2 font-bold text-ocean-950 disabled:opacity-50">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save deck'}
        </button>
        {saveError && <p className="mt-2 text-red-400">{saveError}</p>}
        <h2 className="mt-6 font-display text-xl">Hero powers</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {(heroPowers ?? []).map((h) => (
            <li key={h.id} className="rounded border border-ocean-600 p-2">
              <span className="font-bold">{h.name}</span>
              <span className="ml-2 text-sm text-ocean-300">{h.cp_cost} CP</span>
              <p className="text-sm">{h.power_text}</p>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  )
}
