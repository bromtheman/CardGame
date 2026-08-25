import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { GameAction } from '@shared/engine/engineTypes'
import { supabase } from '../../lib/supabaseClient'

export function useGameActions(gameId: string | undefined, version: number | undefined) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(action: GameAction) {
    if (!gameId || version === undefined) return
    setBusy(true)
    setError(null)
    try {
      const { error: fnError } = await supabase.functions.invoke('game-action', {
        body: { gameId, expectedVersion: version, action },
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
    }
  }
  return { send, busy, error }
}
