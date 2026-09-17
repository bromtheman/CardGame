import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { GameAction } from '@shared/engine/engineTypes'
import { FUNCTIONS_REGION, supabase } from '../../lib/supabaseClient'

export function useGameActions(gameId: string | undefined, version: number | undefined) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  // The action in flight, so a practice game can say "PracticeAI is
  // thinking…" for the ones that hand the turn to the bot (LLM spec §6.3).
  const [pendingType, setPendingType] = useState<GameAction['type'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send(action: GameAction) {
    if (!gameId || version === undefined) return
    setBusy(true)
    setPendingType(action.type)
    setError(null)
    try {
      const { error: fnError } = await supabase.functions.invoke('game-action', {
        body: { gameId, expectedVersion: version, action }, region: FUNCTIONS_REGION,
      })
      if (fnError) {
        if (fnError instanceof FunctionsHttpError) {
          const body = await fnError.context.json().catch(() => null)
          setError(body?.errors?.join('; ') ?? fnError.message)
        } else {
          setError(fnError.message)
        }
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['game', gameId] })
      await queryClient.invalidateQueries({ queryKey: ['gamePlayer', gameId] })
      setBusy(false)
      setPendingType(null)
    }
  }
  return { send, busy, pendingType, error }
}
