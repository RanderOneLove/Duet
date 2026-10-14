import type { ServiceId } from './domain'

/**
 * Итоги: года или месяца. Считаются в главном процессе из журнала
 * прослушиваний и приходят в окно готовыми — экрану остаётся только нарисовать.
 */

export type RecapPeriod = { kind: 'year'; year: number } | { kind: 'month'; year: number; month: number }

/** Ключ периода: «2026» или «2026-10». Под ним помнится, что итоги видели. */
export function recapKey(period: RecapPeriod): string {
  return period.kind === 'year' ? String(period.year) : `${period.year}-${String(period.month).padStart(2, '0')}`
}

/** Песня — одна, даже если звучала из обоих сервисов. */
export interface RecapTrack {
  /** Идентификатор той версии, что звучала чаще, — по нему трек и играет. */
  id: string
  title: string
  artists: string[]
  album: string | null
  cover: string | null
  durationMs: number
  plays: number
  minutes: number
  /** Сервис, из которого звучала чаще. */
  service: ServiceId
  /** Все сервисы, из которых звучала. */
  services: ServiceId[]
}

export interface RecapArtist {
  name: string
  plays: number
  /** Сколько разных песен этого исполнителя звучало. */
  tracks: number
  /** Обложки его самых слушаемых песен — фото исполнителей у нас нет. */
  covers: (string | null)[]
}

export interface RecapRescued {
  /** Сколько разных песен сыграло из второго сервиса. */
  total: number
  vkToYandex: number
  yandexToVk: number
  samples: (RecapTrack & { from: ServiceId })[]
}

export interface Recap {
  period: RecapPeriod
  /** Первое прослушивание в этом периоде и последнее, мс от эпохи. */
  from: number
  to: number
  /** Журнал начался посреди периода — итоги неполные. */
  partial: boolean
  /** Когда журнал начался, — для подписи «с 15 октября». */
  journalSince: number
  plays: number
  minutes: number
  /** Доля прослушиваний, дошедших почти до конца, 0..1. */
  finishedShare: number
  /** Минуты по сервисам. */
  services: Record<ServiceId, number>
  /** Минуты по происхождению: свои списки, волна, вместе. */
  sources: { own: number; wave: number; together: number }
  rescued: RecapRescued | null
  /** До пятидесяти самых слушаемых песен — первые пять на экран, все в плейлист. */
  tracks: RecapTrack[]
  artists: RecapArtist[]
  /** Исполнители, впервые зазвучавшие в этом периоде. null — сравнивать не с чем. */
  discoveries: {
    count: number
    top: { name: string; rank: number; firstAt: number; covers: (string | null)[] } | null
  } | null
  /** Минуты по дням недели (пн = 0) и часам. */
  heat: number[][]
  /** Чаще всего игравший с полуночи до пяти утра. */
  night: (RecapTrack & { nightPlays: number }) | null
  together: { minutes: number; people: { name: string; minutes: number }[] } | null
  /** Только у месячных: сравнение с прошлым месяцем. */
  previous: { minutes: number; topArtist: string | null; artistStreak: number } | null
}

/** Что предложить на Главной прямо сейчас. */
export interface RecapOffer {
  period: RecapPeriod
  key: string
  /** Видели или скрыли: плитки нет, значок без точки. */
  seen: boolean
  kicker: string
  title: string
  sub: string
  covers: (string | null)[]
}

export type RecapCardFormat = 'story' | 'post'
