import { useState } from 'react'
import type { HomeBlock, HomeBlockId } from '@shared/types'

const LABEL: Record<HomeBlockId, { title: string; kind: string }> = {
  wave: { title: 'Моя волна', kind: 'hero' },
  playlists: { title: 'Плейлисты сервисов', kind: 'карусель' },
  liked: { title: 'Вам нравится — первые треки', kind: 'список' },
  downloads: { title: 'Скачанное', kind: 'список' }
}

interface Props {
  blocks: HomeBlock[]
  onChange: (blocks: HomeBlock[]) => void
}

/**
 * Порядок и видимость блоков Главной.
 *
 * Перетаскивание — родное, без библиотеки: строк здесь четыре, и тянуть ради
 * этого зависимость не за что. Строка помечается `draggable`, а всё решение
 * сводится к «кого куда переставить».
 */
export function HomeBlocks({ blocks, onChange }: Props): JSX.Element {
  const [dragging, setDragging] = useState<HomeBlockId | null>(null)

  const move = (from: HomeBlockId, to: HomeBlockId): void => {
    if (from === to) return
    const next = [...blocks]
    const fromAt = next.findIndex((block) => block.id === from)
    const toAt = next.findIndex((block) => block.id === to)
    if (fromAt < 0 || toAt < 0) return
    const [moved] = next.splice(fromAt, 1)
    next.splice(toAt, 0, moved!)
    onChange(next)
  }

  const toggle = (id: HomeBlockId): void =>
    onChange(blocks.map((block) => (block.id === id ? { ...block, shown: !block.shown } : block)))

  return (
    <div className="hblocks">
      {blocks.map((block) => (
        <div
          key={block.id}
          className={`hblock ${block.shown ? '' : 'hblock--off'} ${
            dragging === block.id ? 'hblock--dragging' : ''
          }`}
          draggable
          onDragStart={() => setDragging(block.id)}
          onDragEnd={() => setDragging(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragging) move(dragging, block.id)
            setDragging(null)
          }}
        >
          <span className="hblock__grip" aria-hidden={true}>
            ⠿
          </span>
          <span className="hblock__title">{LABEL[block.id].title}</span>
          <span className="muted hblock__kind">{block.shown ? LABEL[block.id].kind : 'скрыто'}</span>
          <button
            className="toggle"
            aria-pressed={block.shown}
            aria-label={`${LABEL[block.id].title}: ${block.shown ? 'показывать' : 'скрыто'}`}
            onClick={() => toggle(block.id)}
          >
            <i />
          </button>
        </div>
      ))}
    </div>
  )
}
