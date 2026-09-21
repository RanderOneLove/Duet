import type { Playlist, Track } from '@shared/domain'
import { notifyLibraryChanged } from './changed'

/**
 * Обложка плейлиста, у которого её нет, — по первому треку внутри.
 *
 * Оба сервиса отдают мозаику не всегда: у своих плейлистов её часто нет вовсе,
 * и на экране остаётся цветная заглушка. Между тем обложка у списка есть — она
 * просто лежит на первом его треке, как это и делают локальные плейлисты
 * (`localPlaylists`), где треки под рукой.
 *
 * Дотягивать её приходится отдельным запросом, поэтому здесь два правила.
 * Первое: показ не ждёт — список уходит на экран как есть, а найденное
 * приезжает следующим обновлением. Второе: один плейлист спрашивается один
 * раз — иначе каждое открытие Главной снова било бы по сети тем же самым.
 */

/** Что уже нашли: идентификатор плейлиста → обложка. */
const found = new Map<string, string>()

/**
 * Кого уже спрашивали. В ключ входит число треков: плейлист, в который
 * добавили песню, — это другой плейлист, и спросить его стоит заново.
 */
const asked = new Set<string>()

/** Сколько запросов держать в воздухе. Плейлистов бывает под сотню. */
const AT_ONCE = 3

function key(playlist: Playlist): string {
  return `${playlist.id}|${playlist.trackCount}`
}

/** Подставить обложки, найденные прежде. Без сети и без ожидания. */
export function withKnownCovers(items: Playlist[]): Playlist[] {
  if (found.size === 0) return items
  return items.map((playlist) =>
    playlist.coverUrl ? playlist : { ...playlist, coverUrl: found.get(playlist.id) ?? null }
  )
}

/**
 * Дочитать недостающие обложки в фоне и сказать экранам, когда появились.
 *
 * Пустой плейлист пропускается: брать обложку не с чего. Неудача и плейлист,
 * у которого ни у одного трека нет обложки, запоминаются так же, как удача, —
 * повторять нечего.
 */
export function backfillCovers(
  items: Playlist[],
  read: (playlist: Playlist) => Promise<Track[]>
): void {
  const needy = items.filter(
    (playlist) => !playlist.coverUrl && playlist.trackCount > 0 && !asked.has(key(playlist))
  )
  if (needy.length === 0) return
  for (const playlist of needy) asked.add(key(playlist))

  void (async () => {
    let next = 0
    let добыли = false

    const worker = async (): Promise<void> => {
      for (;;) {
        const playlist = needy[next++]
        if (!playlist) return
        try {
          const tracks = await read(playlist)
          const cover = tracks.find((track) => track.coverUrl)?.coverUrl
          if (cover) {
            found.set(playlist.id, cover)
            добыли = true
          }
        } catch {
          // Сервис не ответил — обложка не то, ради чего стоит шуметь.
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(AT_ONCE, needy.length) }, worker))
    // Одно оповещение на всю пачку: экран перерисуется один раз, а не сто.
    if (добыли) notifyLibraryChanged()
  })()
}

/** Отключили сервис — его находки больше не наши. */
export function forgetCovers(service: string): void {
  for (const id of [...found.keys()]) if (id.startsWith(`${service}:`)) found.delete(id)
  for (const id of [...asked]) if (id.startsWith(`${service}:`)) asked.delete(id)
}
