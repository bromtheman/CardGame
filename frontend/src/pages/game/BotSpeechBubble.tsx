import { useEffect } from 'react'

// How long a line stays on the board before it lives only in the Battle log.
export const TABLE_TALK_BUBBLE_MS = 6_000

// PracticeAI's table-talk, shown once as it arrives (LLM spec §6.3) and
// anchored under the header on the opponent's side. Click to dismiss.
export function BotSpeechBubble({ text, onDismiss }: { text: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (text === null) return
    const timer = setTimeout(onDismiss, TABLE_TALK_BUBBLE_MS)
    return () => clearTimeout(timer)
  }, [text, onDismiss])
  if (text === null) return null
  return (
    <button
      type="button"
      onClick={onDismiss}
      title="PracticeAI says — click to dismiss"
      className="absolute right-4 top-14 z-40 max-w-sm rounded-2xl rounded-tr-sm border border-brass-400/60 bg-ocean-950/95 px-4 py-2 text-left text-sm italic text-parchment-100 shadow-plank backdrop-blur"
    >
      <span className="mr-1 not-italic">💬</span>
      {text}
    </button>
  )
}
