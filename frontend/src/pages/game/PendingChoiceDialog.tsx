import type { GameAction, Side } from '@shared/engine/engineTypes'
import type { PendingEffect } from '@shared/engine/gameInit'

// Renders state.pendingEffect. The owed player picks an option or declines;
// the other sees why the board is frozen. Declining is deliberate: the card is
// already paid for, so it only forfeits its own upside, and it is what stops a
// misclick from stranding both players in a game neither can advance.
export function PendingChoiceDialog({
  pending,
  mySide,
  send,
  busy,
}: {
  pending: PendingEffect
  mySide: Side
  send: (action: GameAction) => Promise<void>
  busy: boolean
}) {
  const mine = pending.side === mySide

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-brass-400/60 bg-ocean-900 p-5 shadow-xl">
        <p className="text-xs uppercase tracking-wide text-brass-400">{pending.card.name}</p>
        <h2 className="mt-1 text-lg font-bold text-parchment-100">{pending.prompt}</h2>

        {mine ? (
          <>
            <div className="mt-4 flex flex-col gap-2">
              {pending.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void send({ type: 'RESOLVE_PENDING_EFFECT', choiceId: option.id })}
                  className="rounded border border-ocean-600 px-3 py-2 text-left text-sm font-bold text-parchment-100 hover:border-brass-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ type: 'RESOLVE_PENDING_EFFECT', cancel: true })}
              className="mt-4 text-xs text-parchment-100/70 underline disabled:opacity-50"
            >
              Decline this effect
            </button>
          </>
        ) : (
          <p className="mt-4 text-sm text-parchment-100/80">
            Waiting for your opponent to choose.
          </p>
        )}
      </div>
    </div>
  )
}
