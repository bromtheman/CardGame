import { keywordIcon, keywordLabel } from '../lib/keywords'

// The keyword icon row on a card face. Unknown keywords (a card authored
// ahead of the glossary) still show as a text chip rather than vanishing.
export function KeywordIcons({ keywords }: { keywords: string[] }) {
  if (keywords.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {keywords.map((k) => {
        const icon = keywordIcon(k)
        const label = keywordLabel(k)
        return icon ? (
          <img key={k} src={icon} alt={label} title={label} className="h-6 w-6" />
        ) : (
          <span key={k} title={label} className="rounded bg-ocean-600 px-1 text-xs">{k}</span>
        )
      })}
    </div>
  )
}
