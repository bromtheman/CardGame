import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { type GameRow, isMyMove, useGamesQuery, useUsernames } from '../lib/games'
import { useRealtimeInvalidate } from '../lib/realtime'
import { useAuth } from '../lib/auth'
import { timeAgo } from '../lib/time'
import { supabase } from '../lib/supabaseClient'
import { ConfirmDialog } from '../components/ConfirmDialog'

export function GamesPage() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const { data: games, isLoading, error } = useGamesQuery()
  const me = session?.user.id ?? ''
  const { data: names } = useUsernames(
    (games ?? []).flatMap((g) => [g.player_a, g.player_b]),
  )
  useRealtimeInvalidate('games-list', 'games', [['games']])

  const [confirmGame, setConfirmGame] = useState<GameRow | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  if (isLoading) return <main className="p-8 text-center">Loading games…</main>
  if (error) return <main className="p-8 text-center text-red-400">Failed to load games: {String(error)}</main>

  const all = games ?? []
  const active = all.filter((g) => g.status === 'active')
  const yourMove = active.filter((g) => isMyMove(g as unknown as Parameters<typeof isMyMove>[0], me))
  const waiting = active.filter((g) => !isMyMove(g as unknown as Parameters<typeof isMyMove>[0], me))
  const concluded = all.filter((g) => g.status !== 'active')

  async function handleAbandon(g: GameRow) {
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[g.id]
      return next
    })
    const { error: fnError } = await supabase.functions.invoke('game-action', {
      body: { gameId: g.id, expectedVersion: g.version, action: { type: 'ABANDON' } },
    })
    if (fnError) {
      let message = fnError.message
      if (fnError instanceof FunctionsHttpError) {
        const body = await fnError.context.json().catch(() => null)
        message = body?.errors?.join('; ') ?? fnError.message
      }
      setRowErrors((prev) => ({ ...prev, [g.id]: message }))
    }
    await queryClient.invalidateQueries({ queryKey: ['games'] })
  }

  function opponentOf(g: GameRow) {
    const id = g.player_a === me ? g.player_b : g.player_a
    return names?.get(id) ?? '…'
  }

  function renderRow(g: GameRow, { brass }: { brass?: boolean } = {}) {
    const isActive = g.status === 'active'
    const victory = g.winner_id === me
    return (
      <li key={g.id} className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/game/${g.id}`}
            className={`flex flex-1 items-center gap-4 rounded border p-4 ${
              brass ? 'border-brass-400 bg-ocean-900/60' : 'border-ocean-600 bg-ocean-900/60'
            }`}
          >
            <span className="flex-1">
              vs <span className="font-bold">{opponentOf(g)}</span>
            </span>
            <span className="text-ocean-300">turn {String(g.turn_number)}</span>
            <span className="text-ocean-300">{timeAgo(g.updated_at)}</span>
            {!isActive && (
              <span className={`font-bold ${victory ? 'text-brass-400' : 'text-red-400'}`}>
                {victory ? 'Victory' : 'Defeat'}
              </span>
            )}
            {g.status === 'abandoned' && <span className="text-ocean-300">Abandoned</span>}
          </Link>
          {isActive && (
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setConfirmGame(g)
              }}
              className="shrink-0 text-red-400 underline"
            >
              Abandon ship
            </button>
          )}
        </div>
        {rowErrors[g.id] && <p className="text-sm text-red-400">{rowErrors[g.id]}</p>}
      </li>
    )
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl">Your battles</h1>

      {yourMove.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-xl text-brass-400">Your move</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {yourMove.map((g) => renderRow(g, { brass: true }))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-xl">Waiting on the enemy</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {waiting.map((g) => renderRow(g))}
          </ul>
        </section>
      )}

      {concluded.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-xl">Concluded</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {concluded.map((g) => renderRow(g))}
          </ul>
        </section>
      )}

      {all.length === 0 && <p className="mt-4 text-ocean-300">No battles yet — visit the Harbor.</p>}

      <ConfirmDialog
        open={confirmGame !== null}
        title="Abandon ship?"
        body={`Walking away hands ${confirmGame ? opponentOf(confirmGame) : 'your opponent'} the victory. The battle will be recorded as abandoned.`}
        confirmLabel="Abandon"
        danger
        onConfirm={() => {
          if (confirmGame) void handleAbandon(confirmGame)
          setConfirmGame(null)
        }}
        onCancel={() => setConfirmGame(null)}
      />
    </main>
  )
}
