import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { DECK_FACTIONS, DECK_SIZE } from '@shared/gameSettings'
import { deckCardCount, useDecksQuery } from '../lib/decks'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'

export function DecksPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: decks, isLoading, error } = useDecksQuery()
  const [name, setName] = useState('')
  const [faction, setFaction] = useState<string>(DECK_FACTIONS[0])
  const [formError, setFormError] = useState<string | null>(null)

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!session) return
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 40) { setFormError('Name must be 1-40 characters'); return }
    const { data, error: insertError } = await supabase
      .from('decks')
      .insert({ owner_id: session.user.id, name: trimmed, faction })
      .select()
      .single()
    if (insertError) { setFormError(insertError.message); return }
    await queryClient.invalidateQueries({ queryKey: ['decks'] })
    navigate(`/decks/${data.id}`)
  }

  async function onDelete(id: string, deckName: string) {
    if (!window.confirm(`Scuttle deck "${deckName}"? This cannot be undone.`)) return
    const { error: deleteError } = await supabase.from('decks').delete().eq('id', id)
    if (deleteError) { setFormError(deleteError.message); return }
    await queryClient.invalidateQueries({ queryKey: ['decks'] })
  }

  if (isLoading) return <main className="p-8 text-center">Loading decks…</main>
  if (error) return <main className="p-8 text-center text-red-400">Failed to load decks: {String(error)}</main>

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl">Your fleets</h1>
      <form onSubmit={onCreate} className="mt-4 flex flex-wrap items-center gap-2">
        <input className="rounded bg-ocean-900 p-2" placeholder="New deck name" value={name}
          onChange={(e) => setName(e.target.value)} />
        <select className="rounded bg-ocean-900 p-2" value={faction}
          onChange={(e) => setFaction(e.target.value)}>
          {DECK_FACTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button className="rounded bg-brass-400 px-3 py-2 font-bold text-ocean-950">Create</button>
        {formError && <p className="text-red-400">{formError}</p>}
      </form>
      <ul className="mt-6 flex flex-col gap-3">
        {(decks ?? []).map((d) => (
          <li key={d.id} className="flex items-center gap-4 rounded border border-ocean-600 bg-ocean-900/60 p-4">
            <Link to={`/decks/${d.id}`} className="flex-1">
              <span className="font-display text-xl">{d.name}</span>
              <span className="ml-3 rounded bg-ocean-600 px-2 py-0.5 text-sm">{d.faction}</span>
              <span className="ml-3 text-ocean-300">{deckCardCount(d)}/{DECK_SIZE} cards</span>
            </Link>
            <button onClick={() => onDelete(d.id, d.name)} className="text-red-400 underline">Delete</button>
          </li>
        ))}
        {(decks ?? []).length === 0 && <p className="text-ocean-300">No fleets yet — build one above.</p>}
      </ul>
    </main>
  )
}
