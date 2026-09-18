import { useRef } from 'react'
import type { Track } from '@shared/domain'
import { TrackRow } from './TrackRow'
import { StateBlock } from './StateBlock'
import { useVisibleRange, VIRTUALIZE_FROM } from './useVisibleRange'
import { useRowHeight } from './useRowHeight'


interface Props {
  tracks: Track[]
  loading: boolean
  activeId: string | null
  playing: boolean
  emptyTitle: string
  emptyHint: string
  onPlay: (index: number) => void
  onToggleLike: (track: Track) => void
  downloadedIds?: Set<string>
  onDownload?: (track: Track) => void
  onSimilar?: (track: Track) => void
}

/** The shared list body, including 2m's loading / empty / error states. */
export function TrackList({
  tracks,
  loading,
  activeId,
  playing,
  emptyTitle,
  emptyHint,
  onPlay,
  onToggleLike,
  downloadedIds,
  onDownload,
  onSimilar
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Высота строки зависит от выбранной плотности, поэтому она не константа.
  const rowHeight = useRowHeight()
  // A library runs to thousands of tracks; only the visible ones are rendered.
  const virtual = tracks.length > VIRTUALIZE_FROM
  const { start, end } = useVisibleRange(tracks.length, rowHeight, ref, virtual)

  if (loading && tracks.length === 0) return <StateBlock kind="loading" title="Загружаем…" />
  // If there's an error, TopBar will display it. We just show empty state if we have no data.
  if (tracks.length === 0) return <StateBlock kind="empty" title={emptyTitle} hint={emptyHint} />

  return (
    <div className="tracklist" ref={ref}>
      {start > 0 && <div className="list__gap" style={{ height: start * rowHeight }} />}
      {tracks.slice(start, end).map((track, offset) => {
        const index = start + offset
        return (
          <TrackRow
            key={track.id}
            track={track}
            index={index}
            active={track.id === activeId}
            playing={playing}
            onPlay={() => onPlay(index)}
            onToggleLike={() => onToggleLike(track)}
            downloaded={downloadedIds?.has(track.id)}
            onDownload={onDownload ? () => onDownload(track) : undefined}
            onSimilar={onSimilar ? () => onSimilar(track) : undefined}
          />
        )
      })}
      {end < tracks.length && (
        <div className="list__gap" style={{ height: (tracks.length - end) * rowHeight }} />
      )}
    </div>
  )
}
