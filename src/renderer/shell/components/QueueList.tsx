import { useRef, useState } from 'react'
import { artistLine } from '@shared/domain'
import type { PlayerState } from '@shared/player'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { Cover } from './Cover'
import { useVisibleRange, VIRTUALIZE_FROM } from './useVisibleRange'

/** Must match the `height` on `.queueitem`. */
const ROW_HEIGHT = 46

interface Props {
  state: PlayerState
}

/**
 * The queue from wireframe 2d. A row plays on a single click and can be
 * dragged to another slot — the `⋮⋮` handle used to be decoration.
 */
export function QueueList({ state }: Props): JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // Playing a whole library makes this queue thousands of rows long.
  const virtual = state.queue.length > VIRTUALIZE_FROM
  const { start, end } = useVisibleRange(state.queue.length, ROW_HEIGHT, ref, virtual)

  const drop = (to: number): void => {
    if (dragging !== null && dragging !== to) {
      window.shell.command({ type: 'moveInQueue', from: dragging, to })
    }
    setDragging(null)
    setOver(null)
  }

  return (
    <div className="queue__list">
      <div ref={ref}>
      {start > 0 && <div className="list__gap" style={{ height: start * ROW_HEIGHT }} />}
      {state.queue.slice(start, end).map((item, offset) => {
        const index = start + offset
        return (
        <div
          key={`${item.id}-${index}`}
          className={[
            'queueitem',
            index === state.index ? 'queueitem--on' : '',
            dragging === index ? 'queueitem--dragging' : '',
            over === index && dragging !== index ? 'queueitem--over' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          role="button"
          tabIndex={0}
          title={`${item.title} — ${artistLine(item)}`}
          draggable
          onClick={() => window.shell.command({ type: 'playIndex', index })}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            window.shell.command({ type: 'playIndex', index })
          }}
          onDragStart={(event) => {
            setDragging(index)
            event.dataTransfer.effectAllowed = 'move'
            // Firefox refuses to start a drag without payload.
            event.dataTransfer.setData('text/plain', String(index))
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setOver(index)
          }}
          onDragLeave={() => setOver((current) => (current === index ? null : current))}
          onDrop={(event) => {
            event.preventDefault()
            drop(index)
          }}
          onDragEnd={() => {
            setDragging(null)
            setOver(null)
          }}
        >
          <span className="muted queueitem__drag" aria-hidden={true}>
            ⋮⋮
          </span>
          <Cover url={item.coverUrl} seed={item.title} className="queueitem__art" />
          <div className="queueitem__meta">
            <div className="truncate queueitem__title">{item.title}</div>
            <div className="truncate muted queueitem__artist">{artistLine(item)}</div>
          </div>
          <ServiceBadge service={item.service} />
          <button
            className="queueitem__remove"
            title="Убрать из очереди"
            onClick={(event) => {
              event.stopPropagation()
              window.shell.command({ type: 'removeFromQueue', index })
            }}
          >
            ✕
          </button>
        </div>
        )
      })}
      {end < state.queue.length && (
        <div className="list__gap" style={{ height: (state.queue.length - end) * ROW_HEIGHT }} />
      )}
      </div>
    </div>
  )
}
