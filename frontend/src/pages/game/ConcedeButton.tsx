// The one control that must never be unreachable.
//
// Conceding used to live only in the hand rail, under every full-screen
// overlay the board can raise — so a player stuck behind a fleet-battle modal
// (or the withdrawal modal, or a pending choice) could not leave the game at
// all. The engine has always ALLOWED it: CONCEDE is in both BATTLE_ACTIONS and
// PENDING_ACTIONS, so the block was purely that nothing rendered the button.
//
// Every blocking overlay renders one of these, so the escape hatch travels
// with the thing that blocks it. The confirmation itself is the shared
// ConfirmDialog, which sits at z-[70] — above every overlay here — and stays
// owned by GameBoardPage: one piece of state, one dialog, however many places
// can open it.
export function ConcedeButton({
  onConcede,
  busy,
  className = '',
}: {
  onConcede: () => void
  busy: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onConcede}
      title="Strike your colors and end the game"
      className={`text-sm text-red-400 underline disabled:opacity-50 ${className}`}
    >
      Concede
    </button>
  )
}
