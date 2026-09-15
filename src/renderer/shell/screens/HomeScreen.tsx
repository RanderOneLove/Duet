import type { Connection, HomeSection, Playlist, ServiceId, Track, WaveChoice } from '@shared/domain'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { StateBlock } from '../components/StateBlock'
import { Segmented } from '../components/Segmented'
import { TrackList } from '../components/TrackList'
import { Cover } from '../components/Cover'
import { useServiceFilter } from '../useServiceFilter'
import { Pause, Play } from '../../shared/Icons'
import { artistLine } from '@shared/domain'

interface WaveState {
  tracks: Track[]
  loading: boolean
  error: string | null
  reload: () => void
  /**
   * What the player is doing with this station right now, or null when it is
   * playing something else. The hero follows the radio as it advances rather
   * than showing the batch it was handed when the screen opened.
   */
  playback: { current: Track | null; next: Track[]; playing: boolean } | null
}

interface Props {
  sections: HomeSection[]
  loading: boolean
  connections: Connection[]
  waveService: WaveChoice
  wave: WaveState
  activeId: string | null
  playing: boolean
  onWaveService: (choice: WaveChoice) => void
  onPlayWave: () => void
  onToggleWave: () => void
  onPlayTracks: (tracks: Track[], index: number) => void
  onOpenPlaylist: (playlist: Playlist) => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onSimilar: (track: Track) => void
}

/** Wireframe 2a: the radio hero, one merged playlist row, then liked tracks. */
export function HomeScreen({
  sections,
  loading,
  connections,
  waveService,
  wave,
  activeId,
  playing,
  onWaveService,
  onPlayWave,
  onToggleWave,
  onPlayTracks,
  onOpenPlaylist,
  onToggleLike,
  downloadedIds,
  onDownload,
  onSimilar
}: Props): JSX.Element {
  const available = connections.filter((connection) => connection.connected)
  const playlists = sections.find((section) => section.kind === 'playlists')?.playlists ?? []
  const liked = sections.find((section) => section.kind === 'tracks')?.tracks ?? []

  return (
    <div className="home">
      {available.length > 0 && (
        <WaveHero
          service={waveService}
          wave={wave}
          options={available.map((connection) => connection.service)}
          onService={onWaveService}
          onPlay={onPlayWave}
          onToggle={onToggleWave}
        />
      )}

      {loading && sections.length === 0 ? (
        <SectionSkeletons />
      ) : sections.length === 0 ? (
        <StateBlock
          kind="empty"
          title="Пока пусто"
          hint="Подключите сервис в настройках — здесь появятся ваши плейлисты и треки."
        />
      ) : (
        <>
          {playlists.length > 0 && (
            <section className="home__section">
              <div className="home__head">
                <h2 className="home__title">Ваши плейлисты</h2>
                <span className="muted">оба сервиса · {playlists.length}</span>
              </div>
              <div className="cardrow">
                {playlists.map((playlist) => (
                  <button key={playlist.id} className="card" onClick={() => onOpenPlaylist(playlist)}>
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
            </section>
          )}

          {liked.length > 0 && (
            <LikedBlock
              tracks={liked}
              activeId={activeId}
              playing={playing}
              onPlayTracks={onPlayTracks}
              onToggleLike={onToggleLike}
              downloadedIds={downloadedIds}
              onDownload={onDownload}
              onSimilar={onSimilar}
            />
          )}
        </>
      )}
    </div>
  )
}

/** The same rows as the Liked tab, filtered by service, straight on Home. */
function LikedBlock({
  tracks,
  activeId,
  playing,
  onPlayTracks,
  onToggleLike,
  downloadedIds,
  onDownload,
  onSimilar
}: {
  tracks: Track[]
  activeId: string | null
  playing: boolean
  onPlayTracks: (tracks: Track[], index: number) => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onSimilar: (track: Track) => void
}): JSX.Element {
  const { filter, setFilter, filtered, options } = useServiceFilter(tracks)

  return (
    <section className="home__section">
      <div className="home__head">
        <h2 className="home__title">Вам нравится</h2>
        <div className="home__spacer" />
        <Segmented value={filter} onChange={setFilter} options={options} />
        <button className="pill pill--sm" disabled={filtered.length === 0} onClick={() => onPlayTracks(filtered, 0)}>
          <Play size={13} /> Слушать
        </button>
      </div>

      <TrackList
        tracks={filtered}
        loading={false}
        activeId={activeId}
        playing={playing}
        onPlay={(index) => onPlayTracks(filtered, index)}
        onToggleLike={onToggleLike}
        downloadedIds={downloadedIds}
        onDownload={onDownload}
        onSimilar={onSimilar}
        emptyTitle="В этом сервисе пусто"
        emptyHint="Выберите другую вкладку фильтра."
      />
    </section>
  )
}

/**
 * "Моя волна" from either service — the headline block of the screen, so it is
 * deliberately the largest thing on it.
 */
function WaveHero({
  service,
  wave,
  options,
  onService,
  onPlay,
  onToggle
}: {
  service: WaveChoice
  wave: WaveState
  options: ServiceId[]
  onService: (choice: WaveChoice) => void
  onPlay: () => void
  onToggle: () => void
}): JSX.Element {
  const live = wave.playback
  const current = live?.current ?? null
  // Once the station is playing, everything here follows the player.
  const cover = current?.coverUrl ?? wave.tracks.find((track) => track.coverUrl)?.coverUrl ?? null
  const upNext = live ? live.next : wave.tracks.slice(0, 4)

  return (
    <section className={`wave wave--${service}`}>
      {/* The current cover, blurred, carries the plate's colour. */}
      {cover && <div className="wave__glow" style={{ backgroundImage: `url("${cover}")` }} />}

      <div className="wave__inner">
        <Cover url={cover} seed="wave" className="wave__art" />

        <div className="wave__body">
          <div className="wave__kicker">
            {/* While a woven wave plays, the mark follows whatever is on now. */}
            {current ? (
              <ServiceBadge service={current.service} />
            ) : service === 'both' ? (
              <>
                <ServiceBadge service="yandex" />
                <ServiceBadge service="vk" />
              </>
            ) : (
              <ServiceBadge service={service} />
            )}
            <span>БЕСКОНЕЧНОЕ РАДИО</span>
          </div>

          <h2 className="wave__title">Моя волна</h2>

          <div className="wave__sub">
            {wave.error ? (
              wave.error
            ) : wave.loading ? (
              'Собираем волну…'
            ) : current ? (
              <span className="truncate">
                {current.title} · {artistLine(current)}
              </span>
            ) : (
              'Подстроена под то, что вы слушали'
            )}
          </div>

          <div className="wave__actions">
            {live ? (
              <button className="pill pill--lg" onClick={onToggle}>
                {live.playing ? <Pause size={16} /> : <Play size={16} />}{' '}
                {live.playing ? 'Пауза' : 'Продолжить'}
              </button>
            ) : (
              <button className="pill pill--lg" disabled={wave.tracks.length === 0} onClick={onPlay}>
                <Play size={16} /> Слушать
              </button>
            )}

            {options.length > 1 && (
              <Segmented
                value={service}
                onChange={onService}
                options={[
                  ...options.map((id) => ({ id, label: id === 'vk' ? 'VK' : 'Яндекс' })),
                  { id: 'both' as const, label: 'Обе' }
                ]}
              />
            )}

            {wave.error && (
              <button className="pill pill--outline pill--sm" onClick={wave.reload}>
                Повторить
              </button>
            )}
          </div>

          {upNext.length > 0 && (
            <div className="wave__next">
              <span className="wave__nextlabel">ДАЛЕЕ</span>
              {upNext.map((track) => (
                <span key={track.id} className="wave__nextitem truncate">
                  {track.title}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function SectionSkeletons(): JSX.Element {
  return (
    <>
      {Array.from({ length: 2 }).map((_, i) => (
        <section key={i} className="home__section home__section--skeleton">
          <div className="home__head">
            <div className="skeletonblock" style={{ width: '140px', height: '22px' }} />
          </div>
          <div className="cardrow">
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="card card--skeleton">
                <div className="card__artwrap">
                  <div className="art card__art skeletonblock" />
                </div>
                <div className="skeletonblock" style={{ width: '80%', height: '14px', marginTop: '6px' }} />
                <div className="skeletonblock" style={{ width: '50%', height: '12px', marginTop: '6px' }} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
