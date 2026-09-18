import { useEffect, useState, type RefObject } from 'react'

/**
 * Which slice of a long list is worth putting in the DOM.
 *
 * A liked library runs to thousands of tracks, and rendering every row cost far
 * more than the rows nobody can see: tens of thousands of nodes, and a full
 * reconcile of all of them four times a second as the play position ticks. Only
 * the rows inside the scroll viewport are rendered; the rest are stood in for by
 * a spacer at each end, so the scrollbar still measures the whole list.
 *
 * Rows must therefore be a fixed, known height — see the `height` on
 * `.trackrow` and `.queueitem`.
 */

/** Rows kept rendered beyond each edge, so a flick does not show a blank gap. */
const OVERSCAN = 8

/** Below this a plain list is cheaper than the bookkeeping. */
export const VIRTUALIZE_FROM = 80

export interface VisibleRange {
  start: number
  end: number
}

/**
 * Сколько строк рисовать до первого измерения.
 *
 * Начинать с «показать всё» было дорого ровно один раз — зато каждый раз, когда
 * экран открывается: первый кадр рисовал все пять с половиной тысяч строк и
 * только следующий, после замера, сужал список до видимых. Намерено 2,7 секунды
 * на открытие «Вам нравится». Этого с запасом хватает на любой экран, а точное
 * число приходит тем же кадром, что и прокрутка.
 */
const FIRST_PAINT = 40

export function useVisibleRange(
  count: number,
  rowHeight: number,
  ref: RefObject<HTMLElement>,
  enabled: boolean
): VisibleRange {
  const [range, setRange] = useState<VisibleRange>(() => ({
    start: 0,
    end: enabled ? Math.min(count, FIRST_PAINT) : count
  }))

  useEffect(() => {
    if (!enabled) {
      setRange({ start: 0, end: count })
      return
    }
    const element = ref.current
    if (!element) return
    const scroller = scrollParent(element)

    const measure = (): void => {
      const list = element.getBoundingClientRect()
      const view = scroller.getBoundingClientRect()
      // How much of the list has already passed above the top of the viewport.
      const passed = Math.max(0, view.top - list.top)
      const start = Math.max(0, Math.floor(passed / rowHeight) - OVERSCAN)
      const end = Math.min(count, start + Math.ceil(view.height / rowHeight) + OVERSCAN * 2)
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    }

    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    // Content above the list can change height without any scrolling — artwork
    // arriving in the radio hero, a filter switching — which moves the list
    // under a viewport that never scrolled.
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    if (element.parentElement) observer.observe(element.parentElement)

    return () => {
      scroller.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [count, rowHeight, ref, enabled])

  return range
}

/** The nearest ancestor that actually scrolls, falling back to the page. */
export function scrollParent(node: HTMLElement): HTMLElement {
  let current = node.parentElement
  while (current) {
    const overflow = getComputedStyle(current).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return current
    current = current.parentElement
  }
  return document.documentElement
}
