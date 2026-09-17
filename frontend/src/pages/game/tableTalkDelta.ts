import { newLogLines } from '@shared/ai/llm/logDelta'
import { isTableTalk, TABLE_TALK_PREFIX } from '@shared/ai/llm/tableTalk'

// `PracticeAI: "…"` → `…`. The driver always writes the quotes (formatTableTalk).
export function tableTalkText(line: string): string {
  const body = line.slice(TABLE_TALK_PREFIX.length)
  return body.startsWith('"') && body.endsWith('"') ? body.slice(1, -1) : body
}

// The newest table-talk line among the lines that arrived since `prev`, or
// null. Cap-aware through newLogLines, so a long game does not replay old lines.
export function latestTableTalk(prev: readonly string[], next: readonly string[]): string | null {
  const fresh = newLogLines(prev, next).filter(isTableTalk)
  return fresh.length ? tableTalkText(fresh[fresh.length - 1]) : null
}
