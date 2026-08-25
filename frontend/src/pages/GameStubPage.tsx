import { useParams } from 'react-router-dom'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import { PhysicalCard } from '../components/PhysicalCard'
import type { CardRow } from '../lib/cards'
import { useGameQuery, useMyGamePlayerQuery, useUsernames } from '../lib/games'
import { useRealtimeInvalidate } from '../lib/realtime'
import { useAuth } from '../lib/auth'

function instanceToCardRow(c: CardInstance): CardRow {
  return {
    id: c.instanceId, name: c.name, is_built_in: c.isBuiltIn, owner_id: c.ownerId,
    faction: c.faction, type: c.type, vehicle_type: c.vehicleType,
    blueprint_cost: c.blueprintCost, material_cost: c.materialCost, cp_cost: c.cpCost,
    card_text: c.cardText, image_url: c.imageUrl,
    keywords: c.keywords, meta: c.meta, created_at: '',
  } as CardRow
}

export function GameStubPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const { data: game, isLoading } = useGameQuery(id)
  const { data: mine } = useMyGamePlayerQuery(id)
  const { data: names } = useUsernames([game?.player_a, game?.player_b])
  useRealtimeInvalidate(`game-${id}`, 'games', [['game', id]], `id=eq.${id}`)
  useRealtimeInvalidate(`gp-${id}`, 'game_players', [['gamePlayer', id]], `game_id=eq.${id}`)

  if (isLoading) return <main className="p-8 text-center">Loading game…</main>
  if (!game) {
    return <main className="p-8 text-center">Game not found (or you're not in it).</main>
  }
  const state = game.state as unknown as PublicGameState
  const me = session?.user.id
  const mySide = game.player_a === me ? 'a' : 'b'
  const theirSide = mySide === 'a' ? 'b' : 'a'
  const hand = ((mine?.hand ?? []) as unknown as CardInstance[])

  return (
    <main className="mx-auto max-w-6xl p-6">
      <p className="rounded bg-ocean-900/80 p-2 text-center text-sm text-ocean-300">
        The interactive board arrives in Phase 4 — this is the live game state.
      </p>
      <h1 className="mt-3 font-display text-2xl">
        {names?.get(game.player_a) ?? '…'} vs {names?.get(game.player_b) ?? '…'} — turn{' '}
        {String(game.turn_number)},{' '}
        {game.active_player === me ? 'your turn' : `${names?.get(game.active_player) ?? '…'}'s turn`}
      </h1>
      <div className="mt-4 grid grid-cols-3 gap-4">
        {state.zones?.map((z) => (
          <div key={z.id} className="rounded border border-ocean-600 bg-ocean-900/50 p-3 text-center">
            <p className="font-display text-lg capitalize">{z.biome}</p>
            <p className="text-sm text-ocean-300">Their base: {z.baseHp[theirSide]} HP</p>
            <p className="text-sm text-ocean-300">Your base: {z.baseHp[mySide]} HP</p>
            <p className="mt-1 text-sm">
              Ships — you: {z.cards[mySide].length}, them: {z.cards[theirSide].length}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-6 text-ocean-300">
        <span>Your materials: {state.resources?.[mySide].materials}</span>
        <span>Your CP: {state.resources?.[mySide].cp}</span>
        <span>Their hand: {state.counts?.[theirSide].hand}</span>
        <span>Their deck: {state.counts?.[theirSide].deck}</span>
        <span>Your deck: {state.counts?.[mySide].deck}</span>
      </div>
      <h2 className="mt-6 font-display text-xl">Your hand</h2>
      <div className="mt-2 flex gap-4 overflow-x-auto pb-4">
        {hand.map((c) => (
          <div key={c.instanceId} className="shrink-0 scale-90 origin-top-left">
            <PhysicalCard card={instanceToCardRow(c)} />
          </div>
        ))}
      </div>
    </main>
  )
}
