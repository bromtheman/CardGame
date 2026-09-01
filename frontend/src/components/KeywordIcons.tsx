import { keywordIcon, keywordLabel } from '../lib/keywords'

// The keyword icon row on a card face. Unknown keywords (a card authored
// ahead of the glossary) still show as a text chip rather than vanishing.
// `iconClass` lets a caller pick the icon size. MiniVehicle needs genuinely
// small icons rather than the `scale-75` it used to wrap this in: a transform
// shrinks the pixels but not the layout box, so the row still reserved 24px
// rows (two of them, for a three-keyword card) and that variance is what made
// the board's vehicle lanes change height from one play to the next.
export function KeywordIcons({
  keywords,
  iconClass = 'h-6 w-6',
}: {
  keywords: string[]
  iconClass?: string
}) {
  if (keywords.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {keywords.map((k) => {
        const icon = keywordIcon(k)
        const label = keywordLabel(k)
        return icon ? (
          <img key={k} src={icon} alt={label} title={label} className={iconClass} />
        ) : (
          <span key={k} title={label} className="rounded bg-ocean-600 px-1 text-xs">{k}</span>
        )
      })}
    </div>
  )
}
