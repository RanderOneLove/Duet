import type { Playlist } from '@shared/domain'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { StateBlock } from '../components/StateBlock'
import { Play } from '../../shared/Icons'
import { Cover } from '../components/Cover'
import { NewPlaylistButton } from '../components/AddToPlaylist'

interface Props {
  playlists: Playlist[]
  loading: boolean
  onOpen: (playlist: Playlist) => void
}

/** Wireframe 2f: every playlist from both services as one grid. */
export function LibraryScreen({ playlists, loading, onOpen }: Props): JSX.Element {
  if (loading && playlists.length === 0) {
    return (
      <div className="screen">
        <div className="screen__head">
          <div style={{ width: '140px', height: '22px', background: 'var(--surface-2)', borderRadius: '6px', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }} />
        </div>
        <div className="grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card" style={{ cursor: 'default', animation: 'skeleton-pulse 1.4s ease-in-out infinite' }}>
              <div className="card__artwrap">
                <div className="art card__art" style={{ background: 'var(--surface-2)' }} />
              </div>
              <div style={{ width: '70%', height: '14px', background: 'var(--surface-2)', borderRadius: '4px', marginTop: '6px' }} />
              <div style={{ width: '40%', height: '12px', background: 'var(--surface-2)', borderRadius: '4px', marginTop: '6px' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (playlists.length === 0 && !loading) {
    return <StateBlock kind="empty" title="Плейлистов нет" hint="Создайте плейлист в сервисе — он появится здесь." />
  }

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="screen__title">Моя коллекция</h1>
        <span className="muted">{playlists.length} плейлистов</span>
        <div className="screen__spacer" />
        <NewPlaylistButton />
      </div>
      <div className="grid">
        {playlists.map((playlist) => (
          <button key={playlist.id} className="card" onClick={() => onOpen(playlist)}>
            <div className="card__artwrap">
              <Cover url={playlist.coverUrl} seed={playlist.title} className="card__art" />
              <span className="card__play">
                <Play size={14} />
              </span>
            </div>
            <div className="card__titlerow">
              <span className="truncate card__title">{playlist.title}</span>
              <ServiceBadge service={playlist.service} />
            </div>
            <div className="truncate muted card__sub">{playlist.trackCount} треков</div>
          </button>
        ))}
      </div>
    </div>
  )
}
