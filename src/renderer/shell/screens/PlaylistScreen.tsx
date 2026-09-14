import type { ServiceId, Track } from '@shared/domain'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { TrackList } from '../components/TrackList'
import { Back, Download, Play, Shuffle } from '../../shared/Icons'
import { Cover } from '../components/Cover'

interface Props {
  title: string
  subtitle: string
  coverUrl: string | null
  service: ServiceId
  /** An artist's portrait reads as a circle, a cover as a square. */
  round?: boolean
  tracks: Track[]
  loading: boolean
  activeId: string | null
  playing: boolean
  onBack: () => void
  onPlay: (index: number) => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onDownloadAll: (tracks: Track[]) => void
}

/** One opened collection — a playlist or an album; both read the same way. */
export function PlaylistScreen({
  title,
  subtitle,
  coverUrl,
  service,
  round,
  tracks,
  loading,
  activeId,
  playing,
  onBack,
  onPlay,
  onToggleLike,
  downloadedIds,
  onDownload,
  onDownloadAll
}: Props): JSX.Element {
  return (
    <div className="screen">
      <div className="screen__head">
        <button className="iconbtn" title="Назад" onClick={onBack}>
          <Back size={13} />
        </button>
        <Cover url={coverUrl} seed={title} rounded={round} className="screen__art" />
        <div>
          <h1 className="screen__title">{title}</h1>
          <div className="muted screen__sub">
            <span>{subtitle}</span>
            <ServiceBadge service={service} />
          </div>
        </div>
        <div className="screen__spacer" />
        <button className="pill" disabled={tracks.length === 0} onClick={() => onPlay(0)}>
          <Play size={14} /> Слушать
        </button>
        <button
          className="pill pill--ghost"
          disabled={tracks.length === 0}
          onClick={() => {
            onPlay(0)
            window.shell.command({ type: 'toggleShuffle' })
          }}
        >
          <Shuffle size={14} /> Перемешать
        </button>
        <button
          className="pill pill--outline"
          title="Скачать все треки"
          disabled={tracks.length === 0}
          onClick={() => onDownloadAll(tracks)}
        >
          <Download size={14} /> Скачать всё
        </button>
      </div>
      <TrackList
        tracks={tracks}
        loading={loading}
        activeId={activeId}
        playing={playing}
        onPlay={onPlay}
        onToggleLike={onToggleLike}
        downloadedIds={downloadedIds}
        onDownload={onDownload}
        emptyTitle="Здесь пусто"
        emptyHint="В этой подборке пока нет треков."
      />
    </div>
  )
}
