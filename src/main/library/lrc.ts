import type { LyricLine } from '@shared/domain'

/**
 * Разбор LRC: строки вида `[01:23.45] текст`.
 *
 * Метка может стоять не у каждой строки, и пустые строки в песне — обычное
 * дело; и то и другое просто пропускается.
 *
 * Формат один и тот же у всех, кто вообще отдаёт размеченный текст, поэтому и
 * разбор один: раньше он лежал внутри Яндекса, а теперь тем же путём приходят
 * тексты из открытой базы.
 */
export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of raw.split(/\r?\n/)) {
    const match = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/.exec(row.trim())
    if (!match) continue
    const text = match[3]!.trim()
    if (!text) continue
    const atMs = (Number(match[1]) * 60 + Number(match[2])) * 1000
    lines.push({ atMs: Math.round(atMs), text })
  }
  return lines
}
