import { useEffect, useState } from 'react'

// Shared Escape-to-cancel behavior for both dialogs below — only listens
// while open, and always binds the latest onCancel via a ref-free effect
// dependency (re-registers when onCancel identity changes, which is fine
// since call sites pass a stable-per-render closure).
function useEscapeToCancel(open: boolean, onCancel: () => void) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])
}

// Themed replacement for the native browser confirm dialog. Renders null when closed.
export function ConfirmDialog({
  open, title, body, confirmLabel, danger, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEscapeToCancel(open, onCancel)
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/80"
      onClick={onCancel}
    >
      <div
        className="rounded border border-brass-400 bg-ocean-900 p-6 shadow-plank"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl">{title}</h2>
        <p className="mt-2 text-ocean-300">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border border-ocean-600 px-3 py-2 font-bold text-parchment-100">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded px-3 py-2 font-bold ${danger ? 'bg-red-700 text-parchment-100' : 'bg-brass-400 text-ocean-950'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// Themed replacement for the native browser prompt dialog. Renders null when closed. Keeps its
// own input state and hands the raw string to onConfirm — callers parse and
// clamp themselves (mirrors the old prompt handlers exactly).
export function PromptDialog({
  open, title, body, confirmLabel, inputType, placeholder, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  inputType?: 'number'
  placeholder?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  useEscapeToCancel(open, onCancel)

  useEffect(() => {
    if (open) setValue('')
  }, [open])

  if (!open) return null

  function handleConfirm() {
    onConfirm(value)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/80"
      onClick={onCancel}
    >
      <div
        className="rounded border border-brass-400 bg-ocean-900 p-6 shadow-plank"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl">{title}</h2>
        <p className="mt-2 text-ocean-300">{body}</p>
        <input
          type={inputType ?? 'text'}
          value={value}
          placeholder={placeholder}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm()
          }}
          className="mt-4 w-full rounded bg-ocean-950 p-2 text-parchment-100"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border border-ocean-600 px-3 py-2 font-bold text-parchment-100">
            Cancel
          </button>
          <button onClick={handleConfirm} className="rounded bg-brass-400 px-3 py-2 font-bold text-ocean-950">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
