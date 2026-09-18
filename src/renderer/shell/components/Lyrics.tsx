import { useEffect, useMemo, useRef, useState } from 'react'
import type { Lyrics as LyricsData, Track } from '@shared/domain'
import { StateBlock } from './StateBlock'
import { scrollParent } from './useVisibleRange'

interface Props {
  track: Track | null
  /** Текущая позиция в треке: по ней и подсвечивается строка. */
  positionMs: number
  /** Крупная подача для плеера во всё окно. */
  big?: boolean
  onSeek?: (positionMs: number) => void
}

/**
 * Слова песни — с подсветкой строки, если сервис прислал метки времени.
 *
 * Яндекс отдаёт текст в двух видах, и размеченный (LRC) несёт момент, когда
 * поют каждую строку. Тогда подсветка настоящая, а не подогнанная под длину
 * песни: строку можно нажать и перескочить к ней. У VK меток нет — там просто
 * текст, и притворяться, что он синхронный, было бы обманом.
 */
export function Lyrics({ track, positionMs, big, onSeek }: Props): JSX.Element {
  const [data, setData] = useState<LyricsData | null>(null)
  const [loading, setLoading] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!track) {
      setData(null)
      return
    }
    let current = true
    setLoading(true)
    void window.shell
      .lyrics(track)
      .then((value) => {
        if (current) setData(value)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [track?.id])

  const lines = data?.lines ?? []

  /** Какая строка звучит сейчас — последняя, чьё время уже наступило. */
  const active = useMemo(() => {
    if (lines.length === 0) return -1
    let at = -1
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i]!.atMs <= positionMs) at = i
      else break
    }
    return at
  }, [lines, positionMs])

  /*
   * Подсвеченная строка держится в виду сама — иначе через минуту песня поётся
   * где-то за краем окна.
   *
   * Прокрутка считается вручную, а не через scrollIntoView. Тот прокручивает
   * не только свой список, но и всех предков — а предок здесь объявлен
   * `overflow: hidden`, что запрещает прокрутку человеку, но не программе. На
   * последних строках, которые нельзя поставить по центру списка, он доезжал
   * до плеера целиком и уводил его вверх вместе с кнопкой закрытия.
   */
  useEffect(() => {
    if (active < 0) return
    const list = box.current
    const node = list?.querySelector<HTMLElement>(`[data-line="${active}"]`)
    if (!list || !node) return

    // Прокручивается не сам список, а то, что его показывает: в плеере во всё
    // окно это отдельный слой, в боковой панели — она сама.
    const scroller = scrollParent(list)
    const nodeBox = node.getBoundingClientRect()
    const viewBox = scroller.getBoundingClientRect()
    const delta = nodeBox.top - viewBox.top - (viewBox.height - nodeBox.height) / 2

    scroller.scrollTo({
      top: Math.max(0, Math.min(scroller.scrollTop + delta, scroller.scrollHeight - scroller.clientHeight)),
      behavior: 'smooth'
    })
  }, [active])

  if (!track) return <StateBlock kind="empty" title="Ничего не играет" hint="Включите трек." />
  if (loading) return <StateBlock kind="loading" title="Ищем текст…" />
  if (!data) {
    return (
      <StateBlock
        kind="empty"
        title="Текста нет"
        hint={`${track.service === 'vk' ? 'VK' : 'Яндекс'} не знает слов этого трека.`}
      />
    )
  }

  if (lines.length === 0) {
    // Без меток времени это просто текст — и подавать его надо как текст.
    return <div className={`lyrics ${big ? 'lyrics--big' : ''}`}>{data.text}</div>
  }

  return (
    <div className={`lyrics lyrics--timed ${big ? 'lyrics--big' : ''}`} ref={box}>
      {lines.map((line, index) => (
        <button
          key={`${line.atMs}-${index}`}
          data-line={index}
          className={`lyrics__line ${index === active ? 'lyrics__line--on' : ''} ${
            index < active ? 'lyrics__line--past' : ''
          }`}
          disabled={!onSeek}
          onClick={() => onSeek?.(line.atMs)}
        >
          {line.text}
        </button>
      ))}
    </div>
  )
}
