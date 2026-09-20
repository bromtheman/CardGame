import { newLogLines } from '@shared/ai/llm/logDelta'
import { isSectionMarker } from '@shared/ai/llm/sections'
import { isTableTalk, TABLE_TALK_PREFIX } from '@shared/ai/llm/tableTalk'

// `PracticeAI: "…"` → `…`. The driver always writes the quotes (formatTableTalk).
export function tableTalkText(line: string): string {
  const body = line.slice(TABLE_TALK_PREFIX.length)
  return body.startsWith('"') && body.endsWith('"') ? body.slice(1, -1) : body
}

// The newest spoken line among the lines that arrived since `prev`, else the
// newest section marker, else null. A section commit's delta ends with the
// next section's marker (the sectioned bot turn's checkpoints), which must
// not hide a line the model spoke in the same commit. Cap-aware through
// newLogLines, so a long game does not replay old lines.
export function latestTableTalk(prev: readonly string[], next: readonly string[]): string | null {
  const fresh = newLogLines(prev, next).filter(isTableTalk)
  const spoken = fresh.filter((line) => !isSectionMarker(line))
  const pick = spoken.length ? spoken[spoken.length - 1] : fresh[fresh.length - 1]
  return pick === undefined ? null : tableTalkText(pick)
}
