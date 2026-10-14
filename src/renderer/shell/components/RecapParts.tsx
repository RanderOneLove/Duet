import { useEffect, useState } from 'react'
import type { ServiceId } from '@shared/domain'
import type { Recap, RecapPeriod } from '@shared/recap'
import { Cover } from './Cover'
import vkLogo from '../../assets/vk.png'
import yandexLogo from '../../assets/yandex.png'

/**
 * Общее для экрана итогов и карточек для соцсетей: фон из обложки, веер
 * обложек, круги сервисов и слова.
 */

export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']

export function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100
  const units = count % 10
  if (tens >= 11 && tens <= 14) return many
  if (units === 1) return one
  if (units >= 2 && units <= 4) return few
  return many
}

export const fmt = (value: number): string => value.toLocaleString('ru-RU')

export const dayMonth = (time: number): string => {
  const date = new Date(time)
  return `${date.getDate()} ${MONTHS_OF[date.getMonth()]}`
}

export const monthName = (month: number): string => MONTHS[month - 1]!
export const monthIn = (month: number): string => MONTHS_IN[month - 1]!

export function artistLine(artists: string[]): string {
  return artists.length <= 2 ? artists.join(', ') : `${artists[0]}, ${artists[1]} и ещё ${artists.length - 2}`
}

/** «Это почти 13 суток подряд», «Это 2 часа 22 минуты» — минуты, которые можно представить. */
export function compareMinutes(minutes: number): string {
  if (minutes >= 1440) {
    const days = minutes / 1440
    const whole = Math.floor(days)
    const round = Math.round(days)
    return days - whole >= 0.6
      ? `Это почти ${round} ${plural(round, 'сутки', 'суток', 'суток')} подряд — без сна и перерывов`
      : `Это больше ${whole} ${plural(whole, 'суток', 'суток', 'суток')} подряд — без сна и перерывов`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `Это ${rest} ${plural(rest, 'минута', 'минуты', 'минут')} музыки`
  return `Это ${hours} ${plural(hours, 'час', 'часа', 'часов')} ${rest} ${plural(rest, 'минута', 'минуты', 'минут')}`
}

export function shortMinutes(minutes: number): string {
  return minutes >= 1440 ? `≈ ${Math.round(minutes / 1440)} суток подряд` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

/** «два с половиной месяца» — сколько осталось от года, когда журнал начался. */
export function monthsLeftWord(since: number, yearEnd: number): string {
  const months = Math.round(((yearEnd - since) / (30.44 * 86_400_000)) * 2) / 2
  const words = ['', 'месяц', 'два месяца', 'три месяца', 'четыре месяца', 'пять месяцев', 'шесть месяцев', 'семь месяцев', 'восемь месяцев', 'девять месяцев', 'десять месяцев', 'одиннадцать месяцев']
  const halves = ['полмесяца', 'полтора месяца', 'два с половиной месяца', 'три с половиной месяца', 'четыре с половиной месяца']
  if (months < 1) return 'несколько недель'
  if (months % 1 !== 0) return halves[Math.floor(months)] ?? `${Math.round(months)} месяцев`
  return words[months] ?? `${months} месяцев`
}

export function periodTitle(period: RecapPeriod): string {
  return period.kind === 'year' ? `Итоги ${period.year}` : `Итоги: ${monthName(period.month)}`
}

/** Доли сервисов в процентах, в сумме ровно сто. */
export function serviceShares(recap: Recap): { vk: number; yandex: number } {
  const total = recap.services.vk + recap.services.yandex
  if (total === 0) return { vk: 0, yandex: 0 }
  const vk = Math.round((recap.services.vk / total) * 100)
  return { vk, yandex: 100 - vk }
}

export type ServiceMode = 'both' | 'source' | 'none'

/**
 * Что показать вместо пропорции сервисов. Оба — пропорция. Один, но слушали
 * и свои списки, и волну, — откуда музыка. Иначе показывать нечего.
 */
export function serviceMode(recap: Recap): ServiceMode {
  if (recap.services.vk > 0 && recap.services.yandex > 0) return 'both'
  if (recap.sources.own > 0 && recap.sources.wave > 0) return 'source'
  return 'none'
}

export function onlyService(recap: Recap): ServiceId {
  return recap.services.vk >= recap.services.yandex ? 'vk' : 'yandex'
}

export const SERVICE_NAME: Record<ServiceId, string> = { vk: 'VK Музыки', yandex: 'Яндекс Музыки' }

/**
 * Заголовок тепловой карты словами: когда чаще всего звучит музыка в будни
 * и когда в выходные.
 */
export function whenTitle(heat: number[][]): string {
  const parts: [string, number[]][] = [
    ['по ночам', [1, 2, 3, 4]],
    ['ближе к полуночи', [22, 23, 0]],
    ['вечерами', [18, 19, 20, 21]],
    ['днём', [12, 13, 14, 15, 16, 17]],
    ['по утрам', [6, 7, 8, 9, 10, 11]]
  ]
  const peak = (days: number[]): { name: string; total: number } => {
    let best = parts[0]!
    let bestRate = -1
    let total = 0
    for (const part of parts) {
      const sum = days.reduce((acc, day) => acc + part[1].reduce((inner, hour) => inner + (heat[day]?.[hour] ?? 0), 0), 0)
      total += sum
      const rate = sum / part[1].length
      if (rate > bestRate) {
        bestRate = rate
        best = part
      }
    }
    return { name: best[0], total }
  }
  const weekdays = peak([0, 1, 2, 3, 4])
  const weekend = peak([5, 6])
  const perWeekday = weekdays.total / 5
  const perWeekend = weekend.total / 2
  if (weekdays.name === weekend.name) {
    const when = perWeekend > perWeekday * 1.3 ? 'По выходным' : perWeekday > perWeekend * 1.3 ? 'По будням' : 'Каждый день'
    return `${when}, ${weekdays.name}`
  }
  const lead = weekdays.name[0]!.toUpperCase() + weekdays.name.slice(1)
  return `${lead}, а в выходные — ${weekend.name}`
}

/** Два круга марки Duet: площадь каждого — доля. Геометрия из макета. */
export function venn(first: number, second: number): { r1: number; r2: number; cx1: number; cx2: number; lens: string } {
  const r1 = 60 * Math.sqrt(Math.max(first, 1) / 50)
  const r2 = 60 * Math.sqrt(Math.max(second, 1) / 50)
  const d = (r1 + r2) * 0.7
  const x1 = (240 - (r1 + d + r2)) / 2 + r1
  const x2 = x1 + d
  const xi = (d * d - r2 * r2 + r1 * r1) / (2 * d)
  const h = Math.sqrt(Math.max(0, r1 * r1 - xi * xi))
  const px = x1 + xi
  const f = (v: number): string => v.toFixed(1)
  return {
    r1,
    r2,
    cx1: x1,
    cx2: x2,
    lens: `M${f(px)} ${f(70 - h)}A${f(r1)} ${f(r1)} 0 0 1 ${f(px)} ${f(70 + h)}A${f(r2)} ${f(r2)} 0 0 1 ${f(px)} ${f(70 - h)}Z`
  }
}

export function Venn({
  first,
  second,
  colors,
  className,
  style
}: {
  first: number
  second: number
  colors: [string, string, string]
  className?: string
  style?: React.CSSProperties
}): JSX.Element {
  const g = venn(first, second)
  return (
    <svg viewBox="0 0 240 140" className={className} style={{ overflow: 'visible', ...style }} aria-hidden={true}>
      <circle cx={g.cx1} cy="70" r={g.r1} fill={colors[0]} />
      <circle cx={g.cx2} cy="70" r={g.r2} fill={colors[1]} />
      <path d={g.lens} fill={colors[2]} />
    </svg>
  )
}

export const VENN_SERVICES: [string, string, string] = ['#66aaff', '#ff7a7a', '#b292bc']
export const VENN_SOURCES: [string, string, string] = ['#0a84ff', '#e9e9ed', '#7fa9f5']

const LOGOS: Record<ServiceId, string> = { vk: vkLogo, yandex: yandexLogo }

/** Знак сервиса в квадрате любого размера — в слайдах он считается от окна. */
export function Logo({ service, size }: { service: ServiceId; size: string | number }): JSX.Element {
  return (
    <img
      className="rs-logo"
      src={LOGOS[service]}
      alt={service === 'vk' ? 'VK' : 'Яндекс'}
      style={{ width: size, height: size }}
      draggable={false}
    />
  )
}

export function Art({ url, seed }: { url: string | null; seed: string }): JSX.Element {
  return <Cover url={url} seed={seed} className="rs-art" />
}

/** Стопка обложек уголком — для исполнителей, у которых нет фото. */
export function Fan({
  covers,
  seed,
  size,
  radius,
  className = ''
}: {
  covers: (string | null)[]
  seed: string
  size: string
  radius: string
  className?: string
}): JSX.Element {
  const transforms = ['translate(16%,-7%) rotate(9deg) scale(.84)', 'translate(8%,-3.5%) rotate(4.5deg) scale(.92)', 'none']
  const opacities = [0.7, 0.88, 1]
  const list = covers.slice(0, 3).reverse()
  const offset = 3 - list.length
  return (
    <div className={`rs-fan ${className}`} style={{ width: size, height: size, borderRadius: radius }}>
      {list.map((url, index) => (
        <div key={index} style={{ transform: transforms[index + offset], opacity: opacities[index + offset] }}>
          <Art url={url} seed={`${seed}${index}`} />
        </div>
      ))}
    </div>
  )
}

/** Светлая ли обложка: на ней вуаль нужна плотнее, иначе белый текст пропадёт. */
const lightCache = new Map<string, boolean>()

export function useCoverLight(url: string | null): boolean {
  const [light, setLight] = useState(() => (url ? (lightCache.get(url) ?? false) : false))
  useEffect(() => {
    if (!url) {
      setLight(false)
      return
    }
    const known = lightCache.get(url)
    if (known !== undefined) {
      setLight(known)
      return
    }
    let dropped = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 12
        canvas.height = 12
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return
        context.drawImage(image, 0, 0, 12, 12)
        const { data } = context.getImageData(0, 0, 12, 12)
        let sum = 0
        for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
        const value = sum / (data.length / 4) / 255 > 0.55
        lightCache.set(url, value)
        if (!dropped) setLight(value)
      } catch {
        // Обложка без CORS: яркость не узнать — остаётся обычная вуаль.
      }
    }
    image.src = url
    return () => {
      dropped = true
    }
  }, [url])
  return light
}

/**
 * Фон слайда или карточки: размытая обложка и вуаль. Без обложки — оттенок
 * подставной обложки Duet, как у Cover.
 */
export function RecapBg({
  cover,
  seed,
  plain
}: {
  cover: string | null
  seed: string
  /** Свой фон вместо обложки: у слайда сервисов и происхождения. */
  plain?: 'services' | 'sources'
}): JSX.Element {
  const light = useCoverLight(plain ? null : cover)
  let background: string
  if (plain === 'services') {
    background =
      'radial-gradient(45% 65% at 62% 45%, rgba(0,119,255,.6), transparent 70%), radial-gradient(45% 65% at 88% 60%, rgba(255,40,40,.45), transparent 70%), linear-gradient(150deg,#0d0f18,#16101a)'
  } else if (plain === 'sources') {
    background =
      'radial-gradient(45% 65% at 62% 45%, rgba(10,132,255,.55), transparent 70%), radial-gradient(45% 65% at 88% 60%, rgba(233,233,237,.22), transparent 70%), linear-gradient(150deg,#0d0f18,#121218)'
  } else if (cover) {
    background = `url("${cover}")`
  } else {
    const hue = hashHue(seed)
    background = `linear-gradient(150deg, hsl(${hue} 42% 26%), hsl(${(hue + 38) % 360} 38% 15%))`
  }
  return (
    <div className={`recapbg ${plain ? 'recapbg--plain' : light ? 'recapbg--light' : ''}`} aria-hidden={true}>
      <div className="recapbg__img" style={{ backgroundImage: background }} />
      <div className="recapbg__scrim" />
    </div>
  )
}

export function hashHue(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

/** Кружок с буквой — для тех, с кем слушали: фото людей у нас тоже нет. */
export function faceBackground(name: string): string {
  const hue = hashHue(name)
  return `linear-gradient(135deg, hsl(${hue} 42% 44%), hsl(${(hue + 38) % 360} 38% 26%))`
}
