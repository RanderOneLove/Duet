import { useEffect, useRef, useState } from 'react'
import type { Playlist, ServiceId, Track, WaveChoice } from '@shared/domain'
import { artistLine } from '@shared/domain'
import type { HomeBlockId } from '@shared/types'
import { currentTrack, type PlayerState } from '@shared/player'
import { formatBytes } from '@shared/downloads'
import { formatTime, ratio } from '../../shared/format'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { ServiceBadge, ServiceLogo } from '../../shared/ServiceLogo'
import { Eq } from '../../shared/Eq'
import { Download, Heart, HeartOff, Pause, Play } from '../../shared/Icons'
import { Cover } from '../components/Cover'
import { Segmented } from '../components/Segmented'
import { WaveTuner } from '../components/WaveTuner'
import { TrackList } from '../components/TrackList'
import { PlaylistsBlock, TracksBlock } from '../components/HomeSections'
import { useFiltered, type ServiceFilter } from '../useServiceFilter'
import type { WaveState } from './HomeScreen'

/**
 * Три новых вида Главной из хода 2 макета: «сцена» (2a), «дашборд» (2b) и
 * «дуэт» (2c).
 *
 * Данные у всех трёх те же, что у прежних видов, — меняется только то, как
 * экран их раскладывает. Поэтому здесь одна модель волны (что играет, какая
 * обложка, что дальше) и одни кнопки волны, а виды различаются вёрсткой.
 */

export interface HomeModel {
  filter: ServiceFilter
  shown: (id: HomeBlockId) => boolean
  playlists: Playlist[]
  liked: Track[]
  /** Скачанное: сколько, сколько места и треки, чтобы его включить. */
  downloads: { tracks: Track[]; bytes: number; limitBytes: number }
  options: ServiceId[]
  waveService: WaveChoice
  wave: WaveState
  player: PlayerState
  activeId: string | null
  onWaveService: (choice: WaveChoice) => void
  onPlayWave: () => void
  onToggleWave: () => void
  onPlayTracks: (tracks: Track[], index: number) => void
  onOpenPlaylist: (playlist: Playlist) => void
  onOpenLibrary: () => void
  onOpenLiked: () => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onSimilar: (track: Track) => void
}

/** Что сейчас с волной — одно на все три вида. */
function useWaveView(model: HomeModel): {
  live: WaveState['playback']
  current: Track | null
  cover: string | null
  upNext: Track[]
  title: string
} {
  const live = model.wave.playback
  const current = live?.current ?? null
  const preview = model.wave.tracks
  return {
    live,
    current,
    cover: current?.coverUrl ?? preview.find((track) => track.coverUrl)?.coverUrl ?? null,
    upNext: live ? live.next : preview.slice(0, 4),
    // Станция вокруг трека — не «Моя волна»: подстроена она под песню, а не под вас.
    title: model.wave.seed ? 'Волна по треку' : 'Моя волна'
  }
}

const KICKER: Record<WaveChoice, string> = { yandex: 'ЯНДЕКС', vk: 'VK', both: 'ОБА СЕРВИСА' }

/** Значки станции: у смешанной — оба, у играющей — тот, что звучит сейчас. */
function StationMarks({ choice, current }: { choice: WaveChoice; current: Track | null }): JSX.Element {
  if (current) return <ServiceBadge service={current.service} />
  if (choice === 'both') {
    return (
      <>
        <ServiceBadge service="yandex" />
        <ServiceBadge service="vk" />
      </>
    )
  }
  return <ServiceBadge service={choice} />
}

/**
 * Кнопки волны — одни на все виды. `compact` — для тесной плитки дашборда:
 * сердечко и «не нравится» там круглые, без подписей.
 */
function WaveActions({
  model,
  compact = false,
  segmented = true,
  big = false
}: {
  model: HomeModel
  compact?: boolean
  /** В «дуэте» станцию выбирают круги, и сегмент там лишний. */
  segmented?: boolean
  big?: boolean
}): JSX.Element {
  const { live, current } = useWaveView(model)
  const { wave, options, waveService } = model

  return (
    <div className="stagehero__actions">
      {live ? (
        <button className={`pill ${big ? 'pill--xl' : 'pill--lg'}`} onClick={model.onToggleWave}>
          {live.playing ? <Pause size={16} /> : <Play size={16} />}
          {live.playing ? 'Пауза' : 'Продолжить'}
        </button>
      ) : (
        <button
          className={`pill ${big ? 'pill--xl' : 'pill--lg'}`}
          disabled={wave.loading}
          onClick={model.onPlayWave}
        >
          <Play size={16} /> Слушать
        </button>
      )}

      {segmented && options.length > 1 && (
        <Segmented
          value={waveService}
          onChange={model.onWaveService}
          options={[
            ...options.map((id) => ({ id, label: id === 'vk' ? 'VK' : 'Яндекс' })),
            { id: 'both' as const, label: 'Обе' }
          ]}
        />
      )}

      {!wave.seed && <WaveTuner service={waveService} />}

      <button
        className={`${compact ? 'roundbtn' : 'gbtn'} ${current?.liked ? 'gbtn--on roundbtn--on' : ''}`}
        disabled={!current}
        title={current?.liked ? 'Убрать из избранного' : 'В избранное'}
        onClick={() => window.shell.command({ type: 'toggleLike' })}
      >
        <Heart size={compact ? 15 : 13} />
        {!compact && (current?.liked ? 'В избранном' : 'Нравится')}
      </button>

      {wave.canDislike && (
        <button
          className={compact ? 'roundbtn' : 'gbtn'}
          disabled={!current}
          title={
            waveService === 'vk'
              ? 'Не нравится — больше не попадётся в волне'
              : 'Не нравится — убрать из рекомендаций'
          }
          onClick={() => window.shell.command({ type: 'dislike' })}
        >
          <HeartOff size={compact ? 15 : 13} />
          {!compact && 'Не нравится'}
        </button>
      )}

      {wave.error && (
        <button className="pill pill--outline pill--sm" onClick={wave.reload}>
          Повторить
        </button>
      )}
    </div>
  )
}

/** «Сейчас: …» — с эквалайзером, пока играет. */
function NowLine({
  model,
  light = false,
  eq = true
}: {
  model: HomeModel
  light?: boolean
  /** В плитке дашборда эквалайзер живёт в панели «сейчас играет», а не здесь. */
  eq?: boolean
}): JSX.Element {
  const { live, current } = useWaveView(model)
  const { wave } = model
  return (
    <div className="stagehero__now">
      {live && eq && <Eq playing={live.playing} height={14} bar={3} className={light ? 'eq--light' : ''} />}
      <span className="truncate">
        {wave.error ? (
          wave.error
        ) : wave.loading && !current ? (
          'Собираем волну…'
        ) : current ? (
          <>
            Сейчас: <b>{current.title}</b> · {artistLine(current)}
          </>
        ) : wave.seed ? (
          <>
            От трека <b>{wave.seed.title}</b> · {artistLine(wave.seed)}
          </>
        ) : (
          'Подстроена под то, что вы слушали'
        )}
      </span>
    </div>
  )
}

/**
 * Полоса времени играющего — та же, что в плите, только без перемотки.
 * `joined` — время одной подписью справа, «0:13 / 2:20», как на карточке
 * дашборда; иначе по краям полосы, как в «сцене».
 */
function Progress({
  player,
  className = '',
  joined = false
}: {
  player: PlayerState
  className?: string
  joined?: boolean
}): JSX.Element {
  const position = useSmoothPosition(player)
  return (
    <div className={`stageprogress ${className}`}>
      {!joined && <span className="stageprogress__time">{formatTime(position)}</span>}
      <div className="stageprogress__bar">
        <i style={{ width: `${Math.round(ratio(player.durationMs, position) * 1000) / 10}%` }} />
      </div>
      <span className="stageprogress__time">
        {joined ? `${formatTime(position)} / ${formatTime(player.durationMs)}` : formatTime(player.durationMs)}
      </span>
    </div>
  )
}

/** Блоки ниже hero — в том порядке, что выбран в настройках. */
function RestBlocks({ model, order }: { model: HomeModel; order: HomeBlockId[] }): JSX.Element {
  return (
    <>
      {order.map((id) => {
        if (!model.shown(id)) return null
        if (id === 'playlists' && model.playlists.length > 0) {
          return (
            <PlaylistsBlock
              key="playlists"
              playlists={model.playlists}
              onOpenPlaylist={model.onOpenPlaylist}
              onOpenLibrary={model.onOpenLibrary}
            />
          )
        }
        const tracks = id === 'liked' ? model.liked : id === 'downloads' ? model.downloads.tracks : []
        if (tracks.length === 0) return null
        return (
          <TracksBlock
            key={id}
            title={id === 'liked' ? 'Вам нравится' : 'Скачанное'}
            filter={model.filter}
            tracks={tracks}
            activeId={model.activeId}
            playing={model.player.playing}
            onPlayTracks={model.onPlayTracks}
            onToggleLike={model.onToggleLike}
            downloadedIds={model.downloadedIds}
            onDownload={model.onDownload}
            onSimilar={model.onSimilar}
          />
        )
      })}
    </>
  )
}

/* ===========================================================================
   2a · Сцена: волна во весь первый экран.
=========================================================================== */

export function StageHome({ model, order }: { model: HomeModel; order: HomeBlockId[] }): JSX.Element {
  const view = useWaveView(model)
  const { live, current, cover, upNext } = view
  const showWave = model.shown('wave') && model.options.length > 0

  return (
    <div className="home home--stage">
      {showWave && (
        <section className={`on-hero stagehero ${cover ? '' : 'stagehero--nocover'}`}>
          {/* Свечение — та же обложка, огромная и размытая; движение у него
              своё, из настройки «Моя волна» (дыхание, дрейф, вода). */}
          {cover && (
            <div className="stagehero__glow wave__glow" style={{ backgroundImage: `url("${cover}")` }} />
          )}
          <div className="stagehero__veil" />

          <div className="stagehero__grid">
            <div className="stagehero__body">
              <div className="stagehero__kicker">
                <StationMarks choice={model.waveService} current={current} />
                <span>БЕСКОНЕЧНОЕ РАДИО</span>
                <span className="stagehero__dot">·</span>
                <span>{KICKER[model.waveService]}</span>
              </div>
              <h1 className="stagehero__title stagehero__title--huge">{view.title}</h1>
              <NowLine model={model} light />
              {live && <Progress player={model.player} className="stagehero__progress" />}
              <WaveActions model={model} big />

              {upNext.length > 0 && (
                <div className="stagehero__next">
                  <span className="stagehero__nextlabel">ДАЛЕЕ</span>
                  {upNext.slice(0, 4).map((track, index) => (
                    <button
                      // Волна может повторить трек — ключ с местом, чтобы не было двух одинаковых.
                      key={`${index}-${track.id}`}
                      className="stagechip"
                      title={live ? `Включить «${track.title}»` : 'Включить волну'}
                      onClick={() =>
                        live
                          ? window.shell.command({ type: 'playIndex', index: model.player.index + 1 + index })
                          : model.onPlayWave()
                      }
                    >
                      <Cover url={track.coverUrl} seed={track.title} className="stagechip__art" />
                      <span className="truncate">{track.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <CoverFan front={current ?? model.wave.tracks[0] ?? null} next={upNext} />
          </div>
        </section>
      )}

      <RestBlocks model={model} order={order} />
    </div>
  )
}

/**
 * Веер обложек: играющая впереди, две следующие за ней уголком.
 *
 * Карточки держатся за трек, а не за место: когда трек сменяется, та, что
 * была второй, сама выезжает вперёд — её узел тот же, меняется лишь класс, и
 * переход доводит её до нового места. Ушедшая не исчезает разом, а улетает
 * влево и тает: без этого веер на долю секунды оставался без передней карты.
 *
 * Один трек в веере — одна карта. Пока волна не играет, передняя карта — это
 * первый трек предпросмотра, а «далее» начинается с него же. Два узла с одним
 * ключом React сверяет наугад и лишний не убирает никогда: карты копились
 * по одной на каждое включение волны, и полупрозрачная могла лечь поверх
 * передней.
 */
function CoverFan({ front, next }: { front: Track | null; next: Track[] }): JSX.Element | null {
  const cards = fanCards(front, next)
  const [gone, setGone] = useState<Track | null>(null)
  const last = useRef<Track | null>(front)

  useEffect(() => {
    const previous = last.current
    last.current = front
    if (!previous || previous.id === front?.id) return
    // Ушедшая карта — только если её больше нет среди видимых.
    if (cards.some((card) => card.id === previous.id)) return
    setGone(previous)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front?.id])

  /*
   * Убирает улетевшую отдельный таймер, привязанный к ней самой. Раньше он
   * жил в эффекте смены трека и отменялся следующей сменой — а если та
   * улетевшей не заводила (трек вернулся назад), карта оставалась навсегда.
   */
  useEffect(() => {
    if (!gone) return
    const timer = window.setTimeout(() => setGone(null), 650)
    return () => window.clearTimeout(timer)
  }, [gone])

  if (!front) return null
  const slots = ['front', 'mid', 'back'] as const

  return (
    <div className="coverfan" aria-hidden={true}>
      {gone && (
        <div key={`gone-${gone.id}`} className="coverfan__card coverfan__card--gone">
          <Cover url={gone.coverUrl} seed={gone.title} className="coverfan__art" />
        </div>
      )}
      {/* Задние рисуются первыми: так передняя лежит поверх без z-index-ов. */}
      {cards
        .map((track, index) => ({ track, slot: slots[index]! }))
        .reverse()
        .map(({ track, slot }) => (
          <div key={track.id} className={`coverfan__card coverfan__card--${slot}`}>
            <Cover url={track.coverUrl} seed={track.title} className="coverfan__art" />
          </div>
        ))}
    </div>
  )
}

/** Передняя и до двух следующих — без повторов: ключ карты — трек. */
function fanCards(front: Track | null, next: Track[]): Track[] {
  if (!front) return []
  const cards = [front]
  for (const track of next) {
    if (cards.length === 3) break
    if (!cards.some((card) => card.id === track.id)) cards.push(track)
  }
  return cards
}

/* ===========================================================================
   2b · Дашборд: всё видно сразу.
=========================================================================== */

export function DashHome({ model }: { model: HomeModel }): JSX.Element {
  const view = useWaveView(model)
  const { current, cover } = view
  const showWave = model.shown('wave') && model.options.length > 0
  const showLiked = model.shown('liked') && model.liked.length > 0
  const showPlaylists = model.shown('playlists') && model.playlists.length > 0
  const showDownloads = model.shown('downloads') && model.downloads.tracks.length > 0
  const side = showPlaylists || showDownloads

  return (
    <div className="home home--dash">
      <div className="dash">
        {showWave && (
          <section className={`on-hero dashwave ${cover ? '' : 'dashwave--nocover'}`}>
            {cover && <div className="dashwave__photo" style={{ backgroundImage: `url("${cover}")` }} />}
            <div className="dashwave__veil" />
            <div className="dashwave__body">
              <div className="stagehero__kicker">
                <StationMarks choice={model.waveService} current={current} />
                <span>БЕСКОНЕЧНОЕ РАДИО · {KICKER[model.waveService]}</span>
              </div>
              <h2 className="stagehero__title stagehero__title--large">{view.title}</h2>
              <NowLine model={model} eq={false} />
              <WaveActions model={model} compact />
            </div>
          </section>
        )}

        <NowPanel model={model} wide={!showWave} />

        {showLiked && (
          <section className={`dashcard dashliked ${side ? '' : 'dash--full'}`}>
            <div className="home__head">
              <h2 className="home__title">Вам нравится</h2>
              <span className="muted home__count">{model.liked.length}</span>
              <div className="home__spacer" />
              <button className="gbtn" onClick={() => model.onPlayTracks(model.liked, 0)}>
                <Play size={13} /> Слушать
              </button>
              <button className="gbtn" onClick={model.onOpenLiked}>
                Все
              </button>
            </div>
            <DashTracks model={model} />
          </section>
        )}

        {side && (
          <div className={`dashside ${showLiked ? '' : 'dash--full'}`}>
            {showPlaylists && (
              <section className="dashcard">
                <div className="home__head">
                  <h2 className="home__title">Плейлисты</h2>
                  <span className="muted">оба сервиса · {model.playlists.length}</span>
                  <div className="home__spacer" />
                  <button className="gbtn" onClick={model.onOpenLibrary}>
                    Все
                  </button>
                </div>
                <div className="dashlists">
                  {model.playlists.slice(0, 6).map((playlist) => (
                    <button
                      key={playlist.id}
                      className="dashlist"
                      onClick={() => model.onOpenPlaylist(playlist)}
                    >
                      <Cover url={playlist.coverUrl} seed={playlist.title} className="dashlist__art" />
                      <span className="dashlist__meta">
                        <span className="truncate dashlist__title">{playlist.title}</span>
                        <span className="muted dashlist__sub">
                          {playlist.service && <ServiceLogo service={playlist.service} size={14} />}
                          {playlist.trackCount}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {showDownloads && <DownloadsTile model={model} />}
          </div>
        )}
      </div>
    </div>
  )
}

/** Первые треки избранного — те же строки, что везде, с лайком и загрузкой. */
function DashTracks({ model }: { model: HomeModel }): JSX.Element {
  const filtered = useFiltered(model.liked, model.filter)
  const first = filtered.slice(0, 6)
  return (
    <TrackList
      tracks={first}
      loading={false}
      activeId={model.activeId}
      playing={model.player.playing}
      onPlay={(index) => model.onPlayTracks(filtered, index)}
      onToggleLike={model.onToggleLike}
      downloadedIds={model.downloadedIds}
      onDownload={model.onDownload}
      onSimilar={model.onSimilar}
      emptyTitle="В этом сервисе пусто"
      emptyHint="Выберите другую вкладку фильтра."
    />
  )
}

/**
 * «Сейчас играет» и что дальше. Показывает очередь плеера, а не только волну:
 * дашборд — про то, что звучит, откуда бы оно ни было.
 */
function NowPanel({ model, wide }: { model: HomeModel; wide: boolean }): JSX.Element {
  const { player } = model
  const track = currentTrack(player)
  const fromQueue = player.index >= 0 ? player.queue.slice(player.index + 1, player.index + 5) : []
  const next = track ? fromQueue : model.wave.tracks.slice(0, 4)
  const label = track ? (player.waveService ? 'Далее в волне' : 'Далее в очереди') : 'Волна начнётся с'

  return (
    <section className={`dashcard dashnow ${wide ? 'dash--full' : ''}`}>
      <div className="dashnow__card">
        <Cover url={track?.coverUrl} seed={track?.title ?? 'duet'} className="dashnow__art" />
        <div className="dashnow__meta">
          <div className="dashnow__kicker">
            <span>{track ? 'СЕЙЧАС ИГРАЕТ' : 'НИЧЕГО НЕ ИГРАЕТ'}</span>
            {track && <Eq playing={player.playing} height={11} bar={2.5} />}
          </div>
          <div className="dashnow__titlerow">
            <span className="truncate dashnow__title">{track?.title ?? 'Включите волну или любой список'}</span>
            {track && <ServiceBadge service={track.service} />}
          </div>
          {track ? (
            <Progress player={player} className="dashnow__progress" joined />
          ) : (
            <button className="gbtn dashnow__start" onClick={model.onPlayWave}>
              <Play size={13} /> Включить волну
            </button>
          )}
        </div>
      </div>

      <div className="dashnow__head">
        <span className="dashnow__label">{label}</span>
        {track && <span className="muted">Очередь · {Math.max(0, player.queue.length - player.index - 1)}</span>}
      </div>
      <div className="dashnow__list">
        {next.map((item, index) => (
          <button
            key={`${item.id}-${index}`}
            className="dashrow"
            onClick={() =>
              track
                ? window.shell.command({ type: 'playIndex', index: player.index + 1 + index })
                : model.onPlayWave()
            }
          >
            <Cover url={item.coverUrl} seed={item.title} className="dashrow__art" />
            <span className="dashrow__meta">
              <span className="truncate dashrow__title">{item.title}</span>
              <span className="truncate muted dashrow__artist">{artistLine(item) || '—'}</span>
            </span>
            <ServiceLogo service={item.service} size={16} />
            <span className="muted dashrow__time">{formatTime(item.durationMs)}</span>
          </button>
        ))}
        {next.length === 0 && <div className="muted dashnow__empty">Дальше пока ничего</div>}
      </div>
    </section>
  )
}

/** Скачанное одной плиткой: сколько, сколько места и кнопка «слушать без сети». */
function DownloadsTile({ model }: { model: HomeModel }): JSX.Element {
  const { tracks, bytes, limitBytes } = model.downloads
  const share = limitBytes > 0 ? Math.min(1, bytes / limitBytes) : 0
  return (
    <section className="dashcard dashdl">
      <div className="dashdl__icon">
        <Download size={22} />
      </div>
      <div className="dashdl__meta">
        <div className="dashdl__title">Скачанное · {tracks.length} {plural(tracks.length)}</div>
        <div className="muted dashdl__sub">
          Играет без сети · {formatBytes(bytes)}
          {limitBytes > 0 && ` из ${formatBytes(limitBytes)}`}
        </div>
        {limitBytes > 0 && (
          <div className="dashdl__bar">
            <i style={{ width: `${Math.round(share * 1000) / 10}%` }} />
          </div>
        )}
      </div>
      <button className="gbtn" onClick={() => model.onPlayTracks(tracks, 0)}>
        Слушать
      </button>
    </section>
  )
}

function plural(count: number): string {
  const tens = count % 100
  if (tens >= 11 && tens <= 14) return 'треков'
  switch (count % 10) {
    case 1:
      return 'трек'
    case 2:
    case 3:
    case 4:
      return 'трека'
    default:
      return 'треков'
  }
}

/* ===========================================================================
   2c · Дуэт: два круга марки — выбор станции.
=========================================================================== */

const DUET_HINT: Record<WaveChoice, string> = {
  yandex: 'Станция Яндекса: настроение, язык и подбор настраиваются шестерёнкой.',
  vk: 'Станция VK. «Не нравится» Duet запоминает сам и вычёркивает такие треки из волны.',
  both: 'Две станции вперемешку, повторы отсеиваются. Пересечение кругов и есть Duet.'
}

export function DuetHome({ model, order }: { model: HomeModel; order: HomeBlockId[] }): JSX.Element {
  const view = useWaveView(model)
  const { live, current, upNext } = view
  const showWave = model.shown('wave') && model.options.length > 0
  const choice = model.waveService
  const has = (service: ServiceId): boolean => model.options.includes(service)
  const after = upNext[0]

  // Ниже hero — избранное и плейлисты рядом, остальное — как обычно.
  const showLiked = model.shown('liked') && model.liked.length > 0
  const showPlaylists = model.shown('playlists') && model.playlists.length > 0
  const rest = order.filter((id) => id !== 'liked' && id !== 'playlists' && id !== 'wave')

  return (
    <div className="home home--duet">
      {showWave && (
        <section className="on-hero duethero">
          <div className="duethero__grid">
            <div className="duethero__body">
              <div className="stagehero__kicker">
                <span>БЕСКОНЕЧНОЕ РАДИО · ВЫБЕРИТЕ КРУГ</span>
              </div>
              <h2 className="stagehero__title stagehero__title--duet">{view.title}</h2>
              <div className="duethero__hint">{DUET_HINT[choice]}</div>

              <div className="duethero__now">
                <Cover url={current?.coverUrl ?? view.cover} seed={current?.title ?? 'wave'} className="duethero__art" />
                <span className="duethero__meta">
                  <span className="duethero__titlerow">
                    <span className="truncate duethero__title">
                      {current?.title ?? (model.wave.loading ? 'Собираем волну…' : 'Волна ещё не играет')}
                    </span>
                    {current && <ServiceBadge service={current.service} />}
                  </span>
                  <span className="truncate duethero__sub">
                    {current ? artistLine(current) : 'Выберите круг и включите'}
                    {after && ` · далее «${after.title}»`}
                  </span>
                </span>
                {live && <Eq playing={live.playing} height={14} bar={3} />}
              </div>

              <WaveActions model={model} segmented={false} />
            </div>

            <div className="duetcircles" role="radiogroup" aria-label="Станция">
              <button
                role="radio"
                aria-checked={choice === 'yandex'}
                disabled={!has('yandex')}
                className={`duetcircle duetcircle--ya ${circleState('yandex', choice)}`}
                title={has('yandex') ? 'Волна Яндекса' : 'Яндекс не подключён'}
                onClick={() => model.onWaveService('yandex')}
              />
              <button
                role="radio"
                aria-checked={choice === 'vk'}
                disabled={!has('vk')}
                className={`duetcircle duetcircle--vk ${circleState('vk', choice)}`}
                title={has('vk') ? 'Волна VK' : 'VK не подключён'}
                onClick={() => model.onWaveService('vk')}
              />
              <span className="duetcircles__label duetcircles__label--ya">
                <ServiceLogo service="yandex" size={26} />
                Яндекс
              </span>
              <span className="duetcircles__label duetcircles__label--vk">
                <ServiceLogo service="vk" size={26} />
                VK
              </span>
              {/* «Обе» — в пересечении кругов: смешанная станция и есть Duet. */}
              <button
                role="radio"
                aria-checked={choice === 'both'}
                disabled={!(has('yandex') && has('vk'))}
                className={`duetboth ${choice === 'both' ? 'duetboth--on' : ''}`}
                onClick={() => model.onWaveService('both')}
              >
                Обе
              </button>
            </div>
          </div>
        </section>
      )}

      {(showLiked || showPlaylists) && (
        <div className={`duetgrid ${showLiked && showPlaylists ? '' : 'duetgrid--single'}`}>
          {showLiked && (
            <TracksBlock
              title="Вам нравится"
              filter={model.filter}
              tracks={model.liked}
              activeId={model.activeId}
              playing={model.player.playing}
              onPlayTracks={model.onPlayTracks}
              onToggleLike={model.onToggleLike}
              downloadedIds={model.downloadedIds}
              onDownload={model.onDownload}
              onSimilar={model.onSimilar}
            />
          )}
          {showPlaylists && (
            <section className="home__section">
              <div className="home__head">
                <h2 className="home__title">Плейлисты сервисов</h2>
                <span className="muted">{model.playlists.length}</span>
                <div className="home__spacer" />
                <button className="gbtn" onClick={model.onOpenLibrary}>
                  Все
                </button>
              </div>
              <div className="duetlists">
                {model.playlists.map((playlist) => (
                  <button key={playlist.id} className="card" onClick={() => model.onOpenPlaylist(playlist)}>
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
        </div>
      )}

      <RestBlocks model={model} order={rest} />
    </div>
  )
}

/** Выбранный круг ярче и чуть больше, второй уходит в тень. */
function circleState(service: ServiceId, choice: WaveChoice): string {
  if (choice === 'both') return 'duetcircle--on'
  return choice === service ? 'duetcircle--on duetcircle--lead' : 'duetcircle--off'
}
