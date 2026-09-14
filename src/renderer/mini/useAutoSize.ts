import { useEffect, type RefObject } from 'react'

/**
 * Report the rendered size of the mini player to the main process, which
 * resizes the window to match. The window is transparent and frameless, so any
 * slack around the content would still intercept clicks aimed at whatever is
 * underneath.
 */
export function useAutoSize(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return

    const push = (): void => {
      const rect = element.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      window.mini.resize(Math.ceil(rect.width), Math.ceil(rect.height))
    }

    push()
    const observer = new ResizeObserver(push)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
}
