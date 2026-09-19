import { useEffect, useRef, useState } from 'react'

/**
 * Подержать то, что закрывается, пока оно закрывается.
 *
 * React снимает компонент сразу, как только условие стало ложным, — и уход
 * получается не движением, а исчезновением: экран был и мгновенно пропал.
 * Хук держит его ещё столько, сколько длится прощание, и всё это время
 * отдаёт `closing`, по которому и разыгрывается обратный путь.
 *
 * Возвращает не «true/false», а пару: показывать ли вообще и уходит ли сейчас.
 * Компонент от этого не усложняется — он просто вешает класс.
 */
export function useClosing(open: boolean, msWhenClosing: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)

    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }

    if (!mounted) return

    // Уход мгновенный, если движение выключено: ждать нечего.
    if (msWhenClosing <= 0) {
      setMounted(false)
      setClosing(false)
      return
    }

    setClosing(true)
    timer.current = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, msWhenClosing)

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [open, msWhenClosing])

  return { mounted, closing }
}
