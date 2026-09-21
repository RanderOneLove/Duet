import { useState } from 'react'
import type { ServiceId, Track } from '@shared/domain'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { TrackList } from '../components/TrackList'
import { Back, Check, Download, Play, PlaylistAdd, Shuffle } from '../../shared/Icons'
import { Cover } from '../components/Cover'

interface Props {
  title: string
  subtitle: string
  coverUrl: string | null
  service: ServiceId | null
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
  onSimilar: (track: Track) => void
  /** Overrides the empty state, which differs between a playlist and a detour. */
  empty?: { title: string; hint: string }
  /** Only ours can be deleted, so only ours are given the button. */
  onDelete?: () => void
  /**
   * Имя для «Сохранить как плейлист», и заодно выключатель самой кнопки.
   *
   * Есть у подборок, которые никому не принадлежат: похожее собирается на один
   * раз и исчезает, стоит уйти с экрана. Плейлисту сервиса и альбому сохранять
   * себя незачем — они и так на месте.
   */
  saveAs?: string
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
  onDownloadAll,
  onSimilar,
  empty,
  onDelete,
  saveAs
}: Props): JSX.Element {
  const [saved, setSaved] = useState<'нет' | 'идёт' | 'да'>('нет')

  /*
   * Треки уезжают в плейлист целиком, а не ссылкой на подборку: она собрана
   * сервисом на этот раз и в следующий будет другой. Локальный плейлист тем и
   * хорош, что держит сами треки — и переживает отключение сервиса.
   */
  const save = (): void => {
    if (saved !== 'нет' || tracks.length === 0) return
    setSaved('идёт')
    void window.shell
      .createPlaylist(saveAs ?? title, tracks)
      /*
       * «Сохранено» остаётся до ухода с экрана.
       *
       * Соблазн вернуть кнопку через пару секунд есть, но возвращать её не во
       * что: эта подборка уже лежит в коллекции, и второе нажатие завело бы её
       * второй раз — молча и с тем же именем. Откроют похожее заново — будет и
       * кнопка заново.
       */
      .then(() => setSaved('да'))
      .catch(() => setSaved('нет'))
  }

  return (
    <div className="screen">
      <div className="screen__head">
        <button className="iconbtn" title="Назад" onClick={onBack}>
          <Back size={13} />
        </button>
        <Cover url={coverUrl} seed={title} rounded={round} className="screen__art" />
        <div className="screen__headinfo">
          <h1 className="screen__title">{title}</h1>
          <div className="muted screen__sub">
            <span>{subtitle}</span>
            <ServiceBadge service={service} />
          </div>
        </div>
        <div className="screen__actions">
          <button className="pill" disabled={tracks.length === 0} onClick={() => onPlay(0)}>
            <Play size={14} /> Слушать
          </button>
          {/* Одной командой, а не «включить и следом перещёлкнуть»: та пара
              зависела от того, каким тумблер был до нажатия, и на включённом
              перемешивании выключала его. */}
          <button
            className="pill pill--ghost"
            title="Слушать вперемешку"
            disabled={tracks.length === 0}
            onClick={() =>
              window.shell.command({ type: 'playQueue', tracks, startIndex: 0, shuffle: true })
            }
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
          {saveAs && (
            <button
              className="pill pill--outline"
              title={`Сохранить эти ${tracks.length} треков в свой плейлист`}
              disabled={tracks.length === 0 || saved !== 'нет'}
              onClick={save}
            >
              {saved === 'да' ? <Check size={14} /> : <PlaylistAdd size={14} />}
              {saved === 'да'
                ? 'Сохранено'
                : saved === 'идёт'
                  ? 'Сохраняем…'
                  : 'Сохранить как плейлист'}
            </button>
          )}
          {onDelete && (
            <button className="pill pill--outline pill--sm" onClick={onDelete}>
              Удалить плейлист
            </button>
          )}
        </div>
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
        onSimilar={onSimilar}
        emptyTitle={empty?.title ?? 'Здесь пусто'}
        emptyHint={empty?.hint ?? 'В этой подборке пока нет треков.'}
      />
    </div>
  )
}
