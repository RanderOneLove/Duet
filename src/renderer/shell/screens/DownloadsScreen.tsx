import { useMemo, useState } from 'react'
import type { ServiceId, Track } from '@shared/domain'
import { formatBytes, type DownloadItem, type DownloadsState } from '@shared/downloads'
import { formatTime } from '../../shared/format'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { Cover } from '../components/Cover'
import { Segmented } from '../components/Segmented'
import { StateBlock } from '../components/StateBlock'
import { Check, Play } from '../../shared/Icons'

type Filter = 'all' | 'downloading' | 'failed'

interface Props {
  downloads: DownloadsState
  activeId: string | null
  onPlay: (tracks: Track[], index: number) => void
}

/** Wireframe 2g: what is on disk, what is still coming, and what went wrong. */
export function DownloadsScreen({ downloads, activeId, onPlay }: Props): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')

  const { items, totalBytes, limitBytes, folder } = downloads
  const downloading = items.filter((item) => item.status === 'downloading' || item.status === 'queued')
  const failed = items.filter((item) => item.status === 'failed')
  const done = useMemo(() => items.filter((item) => item.status === 'done'), [items])

  const shown =
    filter === 'downloading' ? downloading : filter === 'failed' ? failed : items

  // Playing a downloaded row should queue the whole offline library.
  const playable = done.map(toTrack)

  const byService = (service: ServiceId): number =>
    done.filter((item) => item.service === service).reduce((sum, item) => sum + item.bytes, 0)
  const vkBytes = byService('vk')
  const yaBytes = byService('yandex')
  // The bar fills against the limit when there is one, so it reads as a budget.
  const scale = limitBytes > 0 ? Math.max(limitBytes, totalBytes) : totalBytes

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="screen__title">Загрузки</h1>
        <span className="muted">
          {done.length} треков · {formatBytes(totalBytes)}
        </span>
        <div className="screen__spacer" />
        <button
          className="pill pill--outline pill--sm"
          title={folder}
          onClick={() => void window.shell.openDownloadsFolder()}
        >
          Открыть папку
        </button>
      </div>

      {items.length === 0 ? (
        <StateBlock
          kind="empty"
          title="Пока ничего не скачано"
          hint="Нажмите стрелку на строке трека или «Скачать всё» в подборке — файлы лягут на диск и будут играть без сети."
        />
      ) : (
        <>
          <div className="storage">
            <div className="storage__bar">
              {scale > 0 && (
                <>
                  <span
                    className="storage__part storage__part--vk"
                    style={{ width: `${(vkBytes / scale) * 100}%` }}
                  />
                  <span
                    className="storage__part storage__part--yandex"
                    style={{ width: `${(yaBytes / scale) * 100}%` }}
                  />
                </>
              )}
            </div>
            <div className="storage__legend muted">
              <span>
                <i className="storage__dot storage__dot--vk" /> VK {formatBytes(vkBytes)}
              </span>
              <span>
                <i className="storage__dot storage__dot--yandex" /> Яндекс {formatBytes(yaBytes)}
              </span>
              <span className="storage__cap">
                {limitBytes > 0
                  ? `${formatBytes(totalBytes)} из ${formatBytes(limitBytes)}`
                  : 'Лимит не задан'}
              </span>
            </div>
          </div>

          <Segmented
            className="downloads__filters"
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'Все', hint: String(items.length) },
              { id: 'downloading', label: 'Скачивается', hint: String(downloading.length) },
              { id: 'failed', label: 'С ошибкой', hint: String(failed.length) }
            ]}
          />

          {shown.length === 0 ? (
            <StateBlock kind="empty" title="Здесь пусто" hint="Выберите другую вкладку." />
          ) : (
            <div className="tracklist">
              {shown.map((item) => (
                <Row
                  key={item.trackId}
                  item={item}
                  active={item.trackId === activeId}
                  onPlay={() => {
                    const index = playable.findIndex((track) => track.id === item.trackId)
                    if (index >= 0) onPlay(playable, index)
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({
  item,
  active,
  onPlay
}: {
  item: DownloadItem
  active: boolean
  onPlay: () => void
}): JSX.Element {
  return (
    <div className={`trackrow ${active ? 'trackrow--active' : ''}`}>
      <button
        className="trackrow__index"
        disabled={item.status !== 'done'}
        title={item.status === 'done' ? 'Воспроизвести' : 'Ещё не скачан'}
        onClick={onPlay}
      >
        <span className="trackrow__glyph trackrow__glyph--always">
          {item.status === 'done' ? <Play size={13} /> : <span className="muted">·</span>}
        </span>
      </button>

      <Cover url={item.coverUrl} seed={item.album ?? item.title} className="trackrow__art" />

      <div className="trackrow__meta">
        <div className="truncate trackrow__title">{item.title}</div>
        <div className="truncate muted trackrow__artist">{item.artists.join(', ') || '—'}</div>
      </div>

      {item.status === 'downloading' || item.status === 'queued' ? (
        <div className="dl__progress">
          <div className="bar">
            <i style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
          <span className="muted dl__percent">
            {item.status === 'queued' ? 'в очереди' : `${Math.round(item.progress * 100)} %`}
          </span>
        </div>
      ) : item.status === 'failed' ? (
        <div className="dl__failed">
          <span className="dl__error truncate" title={item.error ?? ''}>
            {item.error ?? 'Ошибка'}
          </span>
          <button
            className="pill pill--outline pill--sm"
            onClick={() => void window.shell.retryDownload(item.trackId)}
          >
            Повторить
          </button>
        </div>
      ) : (
        <>
          <span className="dl__done" title="Скачан">
            <Check size={13} />
          </span>
          <span className="muted dl__size">{formatBytes(item.bytes)}</span>
        </>
      )}

      <ServiceBadge service={item.service} />
      <span className="muted trackrow__time">{formatTime(item.durationMs)}</span>

      <button
        className="trackrow__like"
        title="Удалить файл"
        onClick={() => void window.shell.removeDownload(item.trackId)}
      >
        ✕
      </button>
    </div>
  )
}

/** The index stores enough of a track to play it back. */
function toTrack(item: DownloadItem): Track {
  return {
    id: item.trackId,
    service: item.service,
    nativeId: item.nativeId,
    title: item.title,
    artists: item.artists,
    artistRefs: [],
    album: item.album,
    albumId: null,
    durationMs: item.durationMs,
    coverUrl: item.coverUrl,
    liked: false,
    available: true
  }
}
