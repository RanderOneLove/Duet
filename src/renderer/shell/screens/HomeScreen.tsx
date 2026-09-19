import type { Connection, HomeSection, Playlist, ServiceId, Track, WaveChoice } from '@shared/domain'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { StateBlock } from '../components/StateBlock'
import { Segmented } from '../components/Segmented'
import { WaveTuner } from '../components/WaveTuner'
import { TrackList } from '../components/TrackList'
import { Cover } from '../components/Cover'
import { useFiltered, type ServiceFilter } from '../useServiceFilter'
import type { HomeBlock, HomeBlockId, HomeLayout } from '@shared/types'
import { Heart, HeartOff, Pause, Play } from '../../shared/Icons'
import { artistLine } from '@shared/domain'

interface WaveState {
  tracks: Track[]
  /** Умеет ли сервис играющего трека «не нравится». */
  canDislike: boolean
  loading: boolean
  error: string | null
  reload: () => void
  /**
   * What the player is doing with this station right now, or null when it is
   * playing something else. The hero follows the radio as it advances rather
   * than showing the batch it was handed when the screen opened.
   */
  playback: { current: Track | null; next: Track[]; playing: boolean } | null
  /** Трек, вокруг которого станция; null — обычная «Моя волна». */
  seed: Track | null
}

interface Props {
  filter: ServiceFilter
  /** Каким показывать экран — выбирается в настройках. */
  layout: HomeLayout
  /** Порядок и видимость блоков — оттуда же. */
  blocks: HomeBlock[]
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
  /** Кнопка «Все» у ряда плейлистов ведёт в «Мою коллекцию». */
  onOpenLibrary: () => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onSimilar: (track: Track) => void
}

/** Wireframe 2a: the radio hero, one merged playlist row, then liked tracks. */
export function HomeScreen({
  filter,
  layout,
  blocks,
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
  onOpenLibrary,
  onToggleLike,
  downloadedIds,
  onDownload,
  onSimilar
}: Props): JSX.Element {
  const available = connections.filter((connection) => connection.connected)
  const playlists = sections.find((section) => section.kind === 'playlists')?.playlists ?? []
  const liked = sections.find((section) => section.kind === 'tracks')?.tracks ?? []

  /** Видимость и порядок берутся из настроек, а не зашиты в разметку. */
  const shown = (id: HomeBlockId): boolean => blocks.find((block) => block.id === id)?.shown ?? true
  const offline = liked.filter((track) => downloadedIds.has(track.id))

  const block = (id: HomeBlockId): JSX.Element | null => {
    if (!shown(id)) return null
    if (id === 'playlists') {
      return playlists.length > 0 ? (
        <PlaylistsBlock
          key="playlists"
          playlists={playlists}
          onOpenPlaylist={onOpenPlaylist}
          onOpenLibrary={onOpenLibrary}
        />
      ) : null
    }
    if (id === 'liked') {
      return liked.length > 0 ? (
        <TracksBlock
          key="liked"
          title="Вам нравится"
          filter={filter}
          tracks={liked}
          activeId={activeId}
          playing={playing}
          onPlayTracks={onPlayTracks}
          onToggleLike={onToggleLike}
          downloadedIds={downloadedIds}
          onDownload={onDownload}
          onSimilar={onSimilar}
        />
      ) : null
    }
    /*
     * Дальше — только «Скачанное», и сказано это явно.
     *
     * Раньше на его ветку сваливалось всё, что не плейлисты и не избранное, —
     * в том числе «Моя волна», которую рисует отдельный блок выше по разметке.
     * Из-за этого «Скачанное» показывалось в самом верху Главной и слушалось
     * тумблера волны, а не своего.
     */
    if (id !== 'downloads') return null

    // Те же треки, что и в избранном, но лежащие на диске: они играют и без
    // сети, и на Главной это отдельный смысл, а не повтор списка.
    return offline.length > 0 ? (
      <TracksBlock
        key="downloads"
        title="Скачанное"
        filter={filter}
        tracks={offline}
        activeId={activeId}
        playing={playing}
        onPlayTracks={onPlayTracks}
        onToggleLike={onToggleLike}
        downloadedIds={downloadedIds}
        onDownload={onDownload}
        onSimilar={onSimilar}
      />
    ) : null
  }

  return (
    <div className={`home home--${layout}`}>
      {available.length > 0 && shown('wave') && (
        <WaveHero
          service={waveService}
          wave={wave}
          compact={layout === 'list'}
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
        <>{blocks.map((item) => block(item.id))}</>
      )}
    </div>
  )
}

/** Ряд плейлистов обоих сервисов. */
function PlaylistsBlock({
  playlists,
  onOpenPlaylist,
  onOpenLibrary
}: {
  playlists: Playlist[]
  onOpenPlaylist: (playlist: Playlist) => void
  onOpenLibrary: () => void
}): JSX.Element {
  return (
    <section className="home__section">
      <div className="home__head">
        <h2 className="home__title">Плейлисты сервисов</h2>
        <span className="muted">оба сервиса · {playlists.length}</span>
        <div className="home__spacer" />
        <button className="gbtn" onClick={onOpenLibrary}>
          Все
        </button>
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
  )
}

/** Список треков на Главной: избранное или скачанное. */
function TracksBlock({
  title,
  filter,
  tracks,
  activeId,
  playing,
  onPlayTracks,
  onToggleLike,
  downloadedIds,
  onDownload,
  onSimilar
}: {
  title: string
  filter: ServiceFilter
  tracks: Track[]
  activeId: string | null
  playing: boolean
  onPlayTracks: (tracks: Track[], index: number) => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onSimilar: (track: Track) => void
}): JSX.Element {
  const filtered = useFiltered(tracks, filter)

  return (
    <section className="home__section">
      <div className="home__head">
        <h2 className="home__title">{title}</h2>
        {/* Счётчик остался, а переключатель сервиса уехал в титульную строку:
            он один на всё окно и не должен повторяться на каждом экране. */}
        <span className="muted home__count">{filtered.length}</span>
        <div className="home__spacer" />
        <button className="gbtn" disabled={filtered.length === 0} onClick={() => onPlayTracks(filtered, 0)}>
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
  compact,
  options,
  onService,
  onPlay,
  onToggle
}: {
  service: WaveChoice
  wave: WaveState
  /** «Списком»: волна сжимается в строку, чтобы сразу шли треки. */
  compact?: boolean
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
    <section className={`on-media wave wave--${service} ${compact ? 'wave--compact' : ''}`}>
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

          {/* Станция вокруг трека — это не «Моя волна», и называть её так
              значило бы врать: подстроена она под одну песню, а не под вас. */}
          <h2 className="wave__title">{wave.seed ? 'Волна по треку' : 'Моя волна'}</h2>

          <div className="wave__sub">
            {wave.error ? (
              wave.error
            ) : wave.loading ? (
              'Собираем волну…'
            ) : current ? (
              <span className="truncate">
                Сейчас: <b>{current.title}</b> · {artistLine(current)}
              </span>
            ) : wave.seed ? (
              <span className="truncate">
                От трека <b>{wave.seed.title}</b> · {artistLine(wave.seed)}
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
              /*
               * Кнопка не зависит от списка предпросмотра: он показывает то,
               * что станция уже выдала, и на свежем запуске пуст. Треки для
               * игры запрашивает само нажатие — гасить её значило бы не давать
               * включить волну до того, как она хоть раз игралась.
               */
              <button className="pill pill--lg" disabled={wave.loading} onClick={onPlay}>
                <Play size={16} /> Слушать
              </button>
            )}

            {/* Подкрутить станцию — рядом с выбором сервиса: и то и другое про
                то, какая это будет волна. */}
            {!wave.seed && <WaveTuner service={service} />}

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

            {/* Сердечко прямо здесь: волну слушают не глядя на список, и
                отметить понравившееся должно быть можно не открывая плеер. */}
            <button
              className={`gbtn ${current?.liked ? 'gbtn--on' : ''}`}
              disabled={!current}
              title={current?.liked ? 'Убрать из избранного' : 'В избранное'}
              onClick={() => window.shell.command({ type: 'toggleLike' })}
            >
              <Heart size={13} /> {current?.liked ? 'В избранном' : 'Нравится'}
            </button>

            {/* В волне «не нравится» уместнее всего: станция сразу перестаёт
                предлагать похожее, а плеер переходит к следующему. */}
            {wave.canDislike && (
              <button
                className="gbtn"
                disabled={!current}
                title={
                  service === 'vk'
                    ? 'Не нравится — больше не попадётся в волне'
                    : 'Не нравится — убрать из рекомендаций'
                }
                onClick={() => window.shell.command({ type: 'dislike' })}
              >
                <HeartOff size={13} /> Не нравится
              </button>
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
