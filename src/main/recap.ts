import type { ServiceId, Track } from '@shared/domain'
import type { PlayRecord } from '@shared/history'
import {
  recapKey,
  type Recap,
  type RecapArtist,
  type RecapOffer,
  type RecapPeriod,
  type RecapTrack
} from '@shared/recap'
import { readHistory } from './history'
import { matchKey } from './library/match'
import { createPlaylist } from './library/playlists'
import { getSettings } from './state/settings'

/**
 * Итоги года и месяца — из журнала прослушиваний.
 *
 * Всё считается здесь, а не в окне: журнал лежит на диске главного процесса,
 * и в окно уходит готовая сводка в несколько килобайт, а не десятки тысяч
 * строк.
 */

/** Меньше — итогов нет: топ из одной песни и пустая тепловая карта — не итоги. */
const MIN_PLAYS = 20
/** Сколько песен идёт в плейлист «Топ года». */
const TOP_TRACKS = 50
/** Тепловая карта из меньшего числа прослушиваний — шум, а не привычка. */
export const MIN_PLAYS_FOR_HEAT = 100
/** Совместное прослушивание короче — не повод для слайда. */
const MIN_TOGETHER_MIN = 20

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/**
 * «Сейчас» для итогов. Пробы подставляют свою дату через DUET_RECAP_NOW,
 * чтобы увидеть декабрьскую плитку в октябре.
 */
export function recapNow(): Date {
  const forced = process.env['DUET_RECAP_NOW']
  const date = forced ? new Date(forced) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function bounds(period: RecapPeriod): [number, number] {
  if (period.kind === 'year') {
    return [new Date(period.year, 0, 1).getTime(), new Date(period.year + 1, 0, 1).getTime()]
  }
  return [new Date(period.year, period.month - 1, 1).getTime(), new Date(period.year, period.month, 1).getTime()]
}

function previousMonth(period: { year: number; month: number }): { year: number; month: number } {
  return period.month === 1 ? { year: period.year - 1, month: 12 } : { year: period.year, month: period.month - 1 }
}

const minutesOf = (records: PlayRecord[]): number => Math.round(records.reduce((sum, record) => sum + record.l, 0) / 60_000)

const artistKey = (name: string): string => name.trim().toLowerCase().replace(/ё/g, 'е')

const isTogether = (record: PlayRecord): boolean =>
  record.src === 'jamHost' || record.src === 'jamGuest' || record.src === 'follow'

export function buildRecap(period: RecapPeriod, all: PlayRecord[] = readHistory()): Recap | null {
  const [start, end] = bounds(period)
  const records = all.filter((record) => record.t >= start && record.t < end)
  if (records.length < MIN_PLAYS) return null

  const journalSince = all[0]?.t ?? records[0]!.t
  const services: Record<ServiceId, number> = { vk: 0, yandex: 0 }
  const sources = { own: 0, wave: 0, together: 0 }
  for (const record of records) {
    services[record.s] += record.l
    if (isTogether(record)) sources.together += record.l
    else if (record.src === 'wave' || record.src === 'trackWave') sources.wave += record.l
    else sources.own += record.l
  }
  const toMinutes = (ms: number): number => Math.round(ms / 60_000)

  const tracks = groupTracks(records)
  const artists = groupArtists(records, tracks)

  return {
    period,
    from: records[0]!.t,
    to: records[records.length - 1]!.t,
    partial: journalSince > start,
    journalSince,
    plays: records.length,
    minutes: minutesOf(records),
    finishedShare: records.filter((record) => record.f).length / records.length,
    services: { vk: toMinutes(services.vk), yandex: toMinutes(services.yandex) },
    sources: { own: toMinutes(sources.own), wave: toMinutes(sources.wave), together: toMinutes(sources.together) },
    rescued: rescuedOf(records),
    tracks: tracks.slice(0, TOP_TRACKS),
    artists: artists.slice(0, 5),
    discoveries: discoveriesOf(all, start, records, artists),
    heat: heatOf(records),
    night: nightOf(records),
    together: togetherOf(records),
    previous: period.kind === 'month' ? previousOf(all, period, artists[0]?.name ?? null) : null
  }
}

/**
 * Песни, склеенные по имени: «Ночь» из VK и «Ночь» из Яндекса — одна строка
 * топа, а не две, у каждой из которых вдвое меньше прослушиваний.
 */
function groupTracks(records: PlayRecord[]): RecapTrack[] {
  type Group = { records: PlayRecord[]; byId: Map<string, number> }
  const groups = new Map<string, Group>()
  for (const record of records) {
    const key = matchKey({ title: record.n, artists: record.a })
    const group: Group = groups.get(key) ?? { records: [], byId: new Map() }
    group.records.push(record)
    group.byId.set(record.id, (group.byId.get(record.id) ?? 0) + 1)
    groups.set(key, group)
  }

  const result: RecapTrack[] = []
  for (const group of groups.values()) {
    const mainId = [...group.byId.entries()].sort((a, b) => b[1] - a[1])[0]![0]
    const main = group.records.find((record) => record.id === mainId)!
    const perService = new Map<ServiceId, number>()
    for (const record of group.records) perService.set(record.s, (perService.get(record.s) ?? 0) + 1)
    result.push({
      id: main.id,
      title: main.n,
      artists: main.a,
      album: main.al,
      // Обложка у какой-нибудь из версий да найдётся.
      cover: main.c ?? group.records.find((record) => record.c)?.c ?? null,
      durationMs: main.d,
      plays: group.records.length,
      minutes: minutesOf(group.records),
      // Сервис той версии, что звучала чаще: по нему трек и сыграет из плейлиста.
      service: main.s,
      services: [...perService.entries()].sort((a, b) => b[1] - a[1]).map(([service]) => service)
    })
  }
  return result.sort((a, b) => b.plays - a.plays || b.minutes - a.minutes)
}

/**
 * Исполнители — по каждому имени в записи, без учёта регистра: «КИНО» и
 * «Кино» один и тот же. Показывается то написание, что встречалось чаще.
 */
function groupArtists(records: PlayRecord[], tracks: RecapTrack[]): RecapArtist[] {
  const groups = new Map<string, { plays: number; spellings: Map<string, number> }>()
  for (const record of records) {
    for (const name of record.a) {
      const key = artistKey(name)
      if (!key) continue
      const group = groups.get(key) ?? { plays: 0, spellings: new Map() }
      group.plays += 1
      group.spellings.set(name, (group.spellings.get(name) ?? 0) + 1)
      groups.set(key, group)
    }
  }
  const result: RecapArtist[] = []
  for (const [key, group] of groups) {
    const own = tracks.filter((track) => track.artists.some((name) => artistKey(name) === key))
    result.push({
      name: [...group.spellings.entries()].sort((a, b) => b[1] - a[1])[0]![0],
      plays: group.plays,
      tracks: own.length,
      covers: own.slice(0, 3).map((track) => track.cover)
    })
  }
  return result.sort((a, b) => b.plays - a.plays)
}

function rescuedOf(records: PlayRecord[]): Recap['rescued'] {
  const saved = records.filter((record) => record.r && record.r !== record.s)
  if (saved.length === 0) return null
  const tracks = groupTracks(saved)
  let vkToYandex = 0
  let yandexToVk = 0
  const seen = new Set<string>()
  for (const record of saved) {
    const key = matchKey({ title: record.n, artists: record.a })
    if (seen.has(key)) continue
    seen.add(key)
    if (record.r === 'vk') vkToYandex += 1
    else yandexToVk += 1
  }
  return {
    total: seen.size,
    vkToYandex,
    yandexToVk,
    samples: tracks.slice(0, 3).map((track) => ({
      ...track,
      from: saved.find((record) => record.id === track.id)?.r ?? (track.service === 'vk' ? 'yandex' : 'vk')
    }))
  }
}

/**
 * Открытия — исполнители, которых в журнале до этого периода не было. Если
 * журнал начался в этом же периоде, сравнивать не с чем: все «новые».
 */
function discoveriesOf(all: PlayRecord[], start: number, records: PlayRecord[], ranking: RecapArtist[]): Recap['discoveries'] {
  const before = all.filter((record) => record.t < start)
  if (before.length < MIN_PLAYS) return null
  const known = new Set(before.flatMap((record) => record.a.map(artistKey)))
  const firstAt = new Map<string, number>()
  for (const record of records) {
    for (const name of record.a) {
      const key = artistKey(name)
      if (!known.has(key) && !firstAt.has(key)) firstAt.set(key, record.t)
    }
  }
  if (firstAt.size === 0) return { count: 0, top: null }
  const rank = ranking.findIndex((artist) => firstAt.has(artistKey(artist.name)))
  // Ранжирование выше — только первые пять; новое могло оказаться и ниже.
  const full = rank >= 0 ? ranking[rank]! : null
  return {
    count: firstAt.size,
    top: full ? { name: full.name, rank: rank + 1, firstAt: firstAt.get(artistKey(full.name))!, covers: full.covers } : null
  }
}

function heatOf(records: PlayRecord[]): number[][] {
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const record of records) {
    const date = new Date(record.t)
    // В JS неделя начинается с воскресенья, у нас — с понедельника.
    const day = (date.getDay() + 6) % 7
    heat[day]![date.getHours()]! += record.l / 60_000
  }
  return heat.map((row) => row.map((minutes) => Math.round(minutes)))
}

function nightOf(records: PlayRecord[]): Recap['night'] {
  const night = records.filter((record) => new Date(record.t).getHours() < 5)
  const top = groupTracks(night)[0]
  if (!top || top.plays < 3) return null
  return { ...top, nightPlays: top.plays }
}

function togetherOf(records: PlayRecord[]): Recap['together'] {
  const shared = records.filter(isTogether)
  const minutes = minutesOf(shared)
  if (minutes < MIN_TOGETHER_MIN) return null
  const people = new Map<string, number>()
  for (const record of shared) {
    for (const name of record.w ?? []) people.set(name, (people.get(name) ?? 0) + record.l)
  }
  return {
    minutes,
    people: [...people.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, ms]) => ({ name, minutes: Math.round(ms / 60_000) }))
  }
}

/** С прошлым месяцем: на сколько больше и сколько месяцев подряд лидирует исполнитель. */
function previousOf(all: PlayRecord[], period: { year: number; month: number }, leader: string | null): Recap['previous'] {
  const prev = previousMonth(period)
  const [start, end] = bounds({ kind: 'month', ...prev })
  const records = all.filter((record) => record.t >= start && record.t < end)
  if (records.length < MIN_PLAYS) return null

  let streak = 1
  let cursor = prev
  while (leader) {
    const [from, to] = bounds({ kind: 'month', ...cursor })
    const month = all.filter((record) => record.t >= from && record.t < to)
    if (month.length < MIN_PLAYS) break
    const top = groupArtists(month, groupTracks(month))[0]
    if (!top || artistKey(top.name) !== artistKey(leader)) break
    streak += 1
    cursor = previousMonth(cursor)
  }
  const tracks = groupTracks(records)
  return { minutes: minutesOf(records), topArtist: groupArtists(records, tracks)[0]?.name ?? null, artistStreak: streak }
}

/**
 * Какие итоги предложить сейчас.
 *
 * Годовые — с 1 декабря до конца января; ноябрь и декабрь в них уже входят,
 * поэтому месячных за эти месяцы нет. Месячные — первую неделю месяца, за
 * прошедший.
 */
export function recapOffer(now = recapNow()): RecapOffer | null {
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const seen = new Set(getSettings().recapSeen)
  const all = readHistory()

  if (month === 12 || month === 1) {
    const period: RecapPeriod = { kind: 'year', year: month === 12 ? year : year - 1 }
    const recap = buildRecap(period, all)
    if (!recap) return null
    const key = recapKey(period)
    const since = sinceText(recap)
    return {
      period,
      key,
      seen: seen.has(key),
      kicker: recap.partial ? 'ИТОГИ ГОДА · ПЕРВЫЙ ГОД С DUET' : 'ИТОГИ ГОДА',
      title: `Ваш ${period.year} в Duet`,
      sub: recap.partial
        ? `${since[0].toUpperCase()}${since.slice(1)}: ${formatMinutes(recap.minutes)} и ${topWord(recap.tracks.length)}${
            recap.plays >= MIN_PLAYS_FOR_HEAT ? ' и часы, когда вы слушаете' : '. Коротко — но уже ваше.'
          }`
        : `${formatMinutes(recap.minutes)}, ${bothWord(recap)}${topWord(recap.tracks.length)} и часы, когда вы слушаете`,
      covers: recap.tracks.slice(0, 3).map((track) => track.cover)
    }
  }

  if (now.getDate() > 7 || month === 1) return null
  const prev = previousMonth({ year, month })
  // Декабрь входит в годовые — отдельной плитки за него нет.
  if (prev.month === 12) return null
  const period: RecapPeriod = { kind: 'month', ...prev }
  const recap = buildRecap(period, all)
  if (!recap) return null
  const key = recapKey(period)
  return {
    period,
    key,
    seen: seen.has(key),
    kicker: 'ИТОГИ МЕСЯЦА',
    title: `Ваш ${MONTHS[prev.month - 1]} в Duet`,
    sub: `${formatMinutes(recap.minutes)}, ${topWord(Math.min(3, recap.tracks.length))} и исполнитель месяца`,
    covers: recap.tracks.slice(0, 3).map((track) => track.cover)
  }
}

/** «с 15 октября» — с какого дня в этом периоде ведётся журнал. */
export function sinceText(recap: Pick<Recap, 'journalSince'>): string {
  const date = new Date(recap.journalSince)
  return `с ${date.getDate()} ${MONTHS_OF[date.getMonth()]}`
}

function formatMinutes(minutes: number): string {
  return `${minutes.toLocaleString('ru-RU')} ${plural(minutes, 'минута', 'минуты', 'минут')}`
}

function topWord(count: number): string {
  if (count >= 5) return 'пять главных треков'
  if (count === 4) return 'четыре главных трека'
  if (count === 3) return 'три главных трека'
  if (count === 2) return 'два главных трека'
  return 'главный трек'
}

function bothWord(recap: Recap): string {
  return recap.services.vk > 0 && recap.services.yandex > 0 ? 'VK и Яндекс вместе, ' : ''
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100
  const units = count % 10
  if (tens >= 11 && tens <= 14) return many
  if (units === 1) return one
  if (units >= 2 && units <= 4) return few
  return many
}

/** «Собрать плейлист "Топ года"»: песни итогов — одним плейлистом Duet. */
export async function recapPlaylist(period: RecapPeriod): Promise<string | null> {
  const recap = buildRecap(period)
  if (!recap) return null
  const title = period.kind === 'year' ? `Топ ${period.year}` : `Топ: ${MONTHS[period.month - 1]} ${period.year}`
  const tracks: Track[] = recap.tracks.map((track) => ({
    id: track.id,
    service: track.service,
    nativeId: track.id.slice(track.id.indexOf(':') + 1),
    title: track.title,
    artists: track.artists,
    artistRefs: [],
    album: track.album,
    albumId: null,
    durationMs: track.durationMs,
    coverUrl: track.cover,
    liked: false,
    available: true
  }))
  return createPlaylist(title, tracks)
}
