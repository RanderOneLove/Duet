import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServiceId } from '@shared/domain'

/**
 * Каталог, переживший закрытие приложения.
 *
 * Обход своей фонотеки стоит дорого: у VK это восемнадцать страниц по двести
 * треков, у Яндекса — список идентификаторов и отдельная гидрация пачками.
 * Намерено 4,4 секунды от запуска до готового списка, и всё это время Главная
 * стоит пустая, хотя показывать ей нужно ровно то же, что и в прошлый раз.
 *
 * Поэтому списки кладутся на диск и при следующем запуске показываются сразу,
 * а обход уходит в фон и подменяет их, когда закончит. Устаревшие данные на
 * несколько секунд — честный обмен за экран, который открывается мгновенно.
 */

/** Ломается при изменении формы Track или Playlist: читать старое опаснее, чем не читать. */
const VERSION = 2

/** Какой список: у сервиса их несколько, и лежат они в разных файлах. */
export type ListKind = 'liked' | 'playlists'

const KINDS: ListKind[] = ['liked', 'playlists']

interface Stored<T> {
  version: number
  at: number
  items: T[]
}

function file(kind: ListKind, service: ServiceId): string {
  return join(app.getPath('userData'), `${kind}-${service}.json`)
}

/** Что было в прошлый раз, или null. */
export function readList<T>(kind: ListKind, service: ServiceId): { at: number; items: T[] } | null {
  try {
    const raw = JSON.parse(readFileSync(file(kind, service), 'utf8')) as Partial<Stored<T>>
    if (raw.version !== VERSION || !Array.isArray(raw.items) || raw.items.length === 0) return null
    return { at: Number(raw.at ?? 0), items: raw.items }
  } catch {
    // Файла нет, он от старой версии или испорчен — обойдёмся без него.
    return null
  }
}

/** Отложить список до следующего запуска. Пишется в фоне и молча. */
export function writeList<T>(kind: ListKind, service: ServiceId, items: T[]): void {
  if (items.length === 0) return
  const payload: Stored<T> = { version: VERSION, at: Date.now(), items }
  void writeFile(file(kind, service), JSON.stringify(payload)).catch(() => undefined)
}

/** Забыть сохранённое — при отключении сервиса его каталог нас не касается. */
export function forgetLists(service: ServiceId): void {
  for (const kind of KINDS) {
    void rm(file(kind, service), { force: true }).catch(() => undefined)
  }
}
