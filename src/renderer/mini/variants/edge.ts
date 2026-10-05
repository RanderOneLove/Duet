import { useEffect, useRef, useState } from 'react'
import type { EdgeInfo } from '@shared/types'

/**
 * Общее у шторки и язычка: три состояния, геометрия каждого и то, как окно
 * переживает переход между ними.
 *
 * Покой — полоска у края, которую почти не видно. Всплывание — короткая
 * строка «что заиграло», на пару секунд после смены трека. Раскрыто — плеер,
 * пока курсор над ним.
 */
export type EdgeState = 'idle' | 'peek' | 'open'

export interface Shape {
  /** Размер чёрной формы. */
  w: number
  h: number
  /** Скругление углов, обращённых от края. */
  r: number
  /** «Ушки» — вогнутые углы, которыми форма срастается с краем экрана. */
  e: number
}

/*
 * Раскрытая шторка на четверть меньше макета: 580×186 на настоящем экране
 * оказалась слишком крупной — она закрывала заметный кусок верха чужого окна
 * ради плеера, который открывают на секунду.
 */
export const NOTCH: Record<EdgeState, Shape> = {
  idle: { w: 210, h: 7, r: 7, e: 7 },
  peek: { w: 360, h: 36, r: 18, e: 11 },
  open: { w: 450, h: 146, r: 28, e: 14 }
}

/** У язычка в раскрытом виде высота зависит от того, есть ли громкость. */
export function sideShape(state: EdgeState, volume: boolean): Shape {
  if (state === 'idle') return { w: 7, h: 150, r: 7, e: 7 }
  if (state === 'peek') return { w: 44, h: 120, r: 18, e: 12 }
  return { w: 136, h: volume ? 470 : 362, r: 30, e: 18 }
}

/**
 * Запас вдоль края — под ушки, и только под них.
 *
 * Тени у формы нет, и это не упущение. Окно прозрачное и ровно по размеру
 * рамки, а тень рисуется за пределами формы: её размытие упиралось в край
 * окна и обрывалось прямой линией — вокруг шторки и язычка стоял тёмный
 * полупрозрачный прямоугольник. То же самое когда-то случилось с плитами
 * (см. начало mini.css), и решение то же: тень либо целиком помещается в
 * окно, либо её нет. Шторке она и не нужна — это вырез в крае, а не плашка.
 *
 * Запас постоянный: окно растёт, а форма не должна при этом съезжать.
 */
export const PAD = 18

/**
 * Самое узкое окно, которое Windows держит честно. Проверено: окно в 7 точек
 * шириной система делает нулевым, в 20 — двадцатипятиточечным, а окно нулевой
 * ширины Chromium перестаёт рисовать, и язычок не мог потом раскрыться. Форма
 * в покое остаётся в 7 точек; остальное — прозрачный запас, сквозь который
 * проходит мышь (см. EdgeInfo).
 */
export const SIDE_MIN_FRAME = 40

/**
 * Сколько длится сворачивание формы — то же число, что в CSS.
 *
 * Сворачивается форма быстрее, чем раскрывается (550 мс): уход на четверть
 * короче появления — правило навыка animate. Раскрытие человек ждёт и
 * смотрит, а свёрнутое ему уже не нужно, и тянуть его незачем.
 */
export const MORPH_MS = 410

/** Сколько держится всплывание при смене трека. */
const PEEK_MS = 2600

const RANK: Record<EdgeState, number> = { idle: 0, peek: 1, open: 2 }

/**
 * Состояние формы.
 *
 * Раскрыто — пока курсор над ней (или закреплено двойным щелчком). Всплывает —
 * когда трек сменился, а смотреть на полоску никто не просил: это способ
 * сказать «заиграло вот это», не открывая окно. Первый трек после появления
 * плиты всплывания не вызывает: его человек и так только что включил.
 */
export function useEdgeState(expanded: boolean, trackId: string | null, peek: boolean): EdgeState {
  const [peeking, setPeeking] = useState(false)
  const seen = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const previous = seen.current
    seen.current = trackId
    /*
     * Всплывает только смена одного трека на другой. Плита появляется пустой и
     * получает трек следом — это не «заиграло новое», а то, что играло и
     * так; раньше шторка на этом всплывала при каждом появлении.
     */
    if (!previous || previous === trackId || !trackId || !peek) return
    setPeeking(true)
    const timer = window.setTimeout(() => setPeeking(false), PEEK_MS)
    return () => window.clearTimeout(timer)
  }, [trackId, peek])

  if (expanded) return 'open'
  return peeking ? 'peek' : 'idle'
}

/**
 * Какое состояние держать для размера окна.
 *
 * Растёт форма — окно сразу становится нового размера, и форма вырастает уже
 * внутри него. Сжимается — окно ждёт, пока она досожмётся: иначе край окна
 * обрезал бы её посреди движения. При выключенном движении ждать нечего.
 */
/** Сворачивается ли форма сейчас — по нему CSS берёт короткое перетекание. */
export function isShrinking(state: EdgeState, held: EdgeState): boolean {
  return RANK[state] < RANK[held]
}

export function useHeldState(state: EdgeState, quiet: boolean): EdgeState {
  const [held, setHeld] = useState(state)

  useEffect(() => {
    if (quiet || RANK[state] >= RANK[held]) {
      setHeld(state)
      return
    }
    const timer = window.setTimeout(() => setHeld(state), MORPH_MS + 40)
    return () => window.clearTimeout(timer)
  }, [state, held, quiet])

  return RANK[state] > RANK[held] ? state : held
}

/**
 * Сообщить окну, где форма и ловит ли она мышь. Шлётся только при изменении:
 * само сообщение заставляет главный процесс переставлять обработку мыши.
 */
export function useReportEdge(onEdge: ((info: EdgeInfo) => void) | undefined, info: EdgeInfo): void {
  const key = `${info.hit.x}|${info.hit.y}|${info.hit.width}|${info.hit.height}|${info.interactive}`
  useEffect(() => {
    onEdge?.(info)
    // info пересоздаётся на каждой отрисовке; меняется он ровно тогда, когда ключ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onEdge])
}

/** Выключено ли движение — общий ответ для всего приложения. */
export { useQuietMotion as useQuiet } from '../../shared/useQuietMotion'

/** Откуда играет — подпись над названием в раскрытом виде. */
export function contextLabel(player: {
  waveSeed: unknown
  waveService: unknown
  following: unknown
}): string {
  if (player.following) return 'Слушаете вместе'
  if (player.waveSeed) return 'Волна по треку'
  if (player.waveService) return 'Моя волна'
  return 'Очередь'
}
