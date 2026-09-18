import { useEffect, useState } from 'react'
import { ROW_HEIGHT, type Density } from '@shared/types'

/**
 * Высота строки списка при выбранной плотности.
 *
 * Виртуализация считает, сколько строк помещается в окно, и потому обязана
 * знать их высоту точно. Держать это число в двух местах — в CSS и в коде —
 * значит однажды разойтись; поэтому источник один, а сюда значение приходит с
 * корня документа, куда его кладёт оформление.
 */
export function useRowHeight(): number {
  const [height, setHeight] = useState(() => read())

  useEffect(() => {
    const observer = new MutationObserver(() => setHeight(read()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-density']
    })
    return () => observer.disconnect()
  }, [])

  return height
}

function read(): number {
  const density = (document.documentElement.dataset.density as Density) || 'normal'
  return ROW_HEIGHT[density] ?? ROW_HEIGHT.normal
}
