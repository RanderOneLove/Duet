import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Recap, RecapCardFormat, RecapPeriod, RecapTrack } from '@shared/recap'
import { recapKey } from '@shared/recap'
import { Close, Download, DuetMark, Maximize, Minimize, Pause, Play, PlaylistAdd, TrayDown } from '../../shared/Icons'
import {
  Art,
  Fan,
  Logo,
  RecapBg,
  SERVICE_NAME,
  VENN_SERVICES,
  VENN_SOURCES,
  Venn,
  artistLine,
  compareMinutes,
  dayMonth,
  faceBackground,
  fmt,
  monthIn,
  monthName,
  monthsLeftWord,
  onlyService,
  periodTitle,
  plural,
  serviceMode,
  serviceShares,
  shortMinutes,
  whenTitle
} from '../components/RecapParts'

/**
 * Итоги — история из слайдов на всё окно, как плеер во весь экран.
 *
 * Каждый слайд — одна главная цифра на размытой обложке своего главного
 * трека. Листается кликом (левая треть — назад) и стрелками, сам — раз в
 * семь секунд, пока не нажата пауза. Слайдов, для которых нет данных, нет:
 * короткая история лучше пустых мест.
 */

const SLIDE_MS = 7000
/** Тепловая карта из меньшего — шум, а не привычка. Та же граница, что в главном. */
const MIN_PLAYS_FOR_HEAT = 100

type SlideKind = 'cover' | 'minutes' | 'services' | 'rescued' | 'tracks' | 'artists' | 'discoveries' | 'when' | 'together' | 'final'

interface Slide {
  kind: SlideKind
  cover: string | null
  seed: string
  plain?: 'services' | 'sources'
}

interface Props {
  period: RecapPeriod
  quiet: boolean
  onClose: () => void
  onOpenLibrary: () => void
}

export function RecapScreen({ period, quiet, onClose, onOpenLibrary }: Props): JSX.Element {
  const [recap, setRecap] = useState<Recap | null | undefined>(undefined)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    let dropped = false
    void window.shell.recap(period).then((value) => {
      if (!dropped) setRecap(value)
    })
    // Открыли — значит, видели: плитка уходит, значок остаётся без точки.
    window.shell.recapSeen(recapKey(period))
    return () => {
      dropped = true
    }
  }, [period])

  const slides = useMemo(() => (recap ? buildSlides(recap) : []), [recap])
  const last = slides.length - 1

  const go = useCallback(
    (step: number) => setIndex((current) => Math.max(0, Math.min(last, current + step))),
    [last]
  )

  // Новый слайд въезжает заново: сначала прячем, на следующем кадре показываем.
  useEffect(() => {
    setEntered(false)
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => setEntered(true)))
    return () => window.cancelAnimationFrame(frame)
  }, [index, slides.length])

  // Сам листается, пока не пауза и не последний слайд.
  useEffect(() => {
    if (paused || index >= last || slides.length === 0) return
    const timer = window.setTimeout(() => go(1), SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [index, paused, last, slides.length, go])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight') go(1)
      if (event.key === 'ArrowLeft') go(-1)
      if (event.key === 'Escape') onClose()
      if (event.key === ' ') setPaused((value) => !value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  const slide = slides[Math.min(index, Math.max(0, last))]

  return (
    <div
      className={`recap ${quiet ? 'recap--quiet' : ''}`}
      style={{ ['--recap-slide' as string]: `${SLIDE_MS}ms` }}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        go((event.clientX - box.left) / box.width < 0.3 ? -1 : 1)
      }}
    >
      {slide && <RecapBg cover={slide.cover} seed={slide.seed} plain={slide.plain} />}

      <div className="recap__top" onClick={stop}>
        <DuetMark size={20} />
        <span className="recap__year">{periodTitle(period)}</span>
        <div className="wincontrols nodrag">
          <button title="Свернуть окно" onClick={() => window.shell.minimize()}>
            <Minimize />
          </button>
          <button title="Развернуть на весь экран" onClick={() => window.shell.maximizeToggle()}>
            <Maximize />
          </button>
          <button title="Свернуть в трей" onClick={() => window.shell.hideToTray()}>
            <TrayDown />
          </button>
          <button className="wincontrols__close" title="Закрыть в трей" onClick={() => window.shell.hideToTray()}>
            <Close />
          </button>
        </div>
      </div>

      {slides.length > 0 && (
        <div className="recap__bars">
          {slides.map((_, at) => (
            <div
              key={at === index ? `run-${index}-${paused}` : at}
              className={`recap__bar ${
                at < index
                  ? 'recap__bar--done'
                  : at > index
                    ? ''
                    : paused || quiet || index === last
                      ? 'recap__bar--still'
                      : 'recap__bar--run'
              }`}
            >
              <i />
            </div>
          ))}
        </div>
      )}

      <div className="recap__ctl" onClick={stop}>
        {slides.length > 1 && (
          <button className="recap__round" title={paused ? 'Дальше' : 'Пауза'} onClick={() => setPaused((value) => !value)}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        )}
        <button className="recap__round" title="Закрыть итоги" onClick={onClose}>
          <Close size={13} />
        </button>
      </div>

      <div className={`recap__content ${entered ? 'is-in' : ''}`}>
        {recap === null && <Empty />}
        {recap && slide && (
          <SlideBody slide={slide} recap={recap} onOpenLibrary={onOpenLibrary} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

const stop = (event: React.MouseEvent): void => event.stopPropagation()

function Empty(): JSX.Element {
  return (
    <div className="rs-center">
      <div className="rs-kicker">ИТОГИ</div>
      <h2 className="rs-h2">Пока мало музыки</h2>
      <p className="rs-p">Итоги появятся, когда в журнале наберётся хотя бы двадцать прослушиваний.</p>
    </div>
  )
}

function buildSlides(recap: Recap): Slide[] {
  const top = recap.tracks[0]
  const topCover = top?.cover ?? null
  const seed = top?.title ?? 'duet'
  const year = recap.period.kind === 'year'
  const slides: Slide[] = []
  const add = (kind: SlideKind, cover = topCover, slideSeed = seed, plain?: Slide['plain']): void => {
    slides.push({ kind, cover, seed: slideSeed, plain })
  }

  // У месячных вступления нет — сразу с цифры: их смотрят мельком.
  if (year) add('cover')
  add('minutes')
  const mode = serviceMode(recap)
  if (mode !== 'none') add('services', null, 'services', mode === 'both' ? 'services' : 'sources')
  if (year && recap.rescued && recap.rescued.total > 0) {
    add('rescued', recap.rescued.samples[0]?.cover ?? null, recap.rescued.samples[0]?.title ?? 'rescued')
  }
  add('tracks')
  const artist = recap.artists[0]
  if (artist) add('artists', artist.covers[0] ?? null, artist.name)
  const discoveries = recap.discoveries
  if (discoveries?.top && discoveries.count > (year ? 0 : 3)) {
    add('discoveries', discoveries.top.covers[0] ?? null, discoveries.top.name)
  }
  if (year && recap.plays >= MIN_PLAYS_FOR_HEAT) add('when', recap.night?.cover ?? topCover, recap.night?.title ?? seed)
  if (year && recap.together) add('together', recap.tracks[1]?.cover ?? topCover, recap.tracks[1]?.title ?? seed)
  add('final')
  return slides
}

function SlideBody({
  slide,
  recap,
  onOpenLibrary,
  onClose
}: {
  slide: Slide
  recap: Recap
  onOpenLibrary: () => void
  onClose: () => void
}): JSX.Element {
  switch (slide.kind) {
    case 'cover':
      return <CoverSlide recap={recap} />
    case 'minutes':
      return <MinutesSlide recap={recap} />
    case 'services':
      return <ServicesSlide recap={recap} />
    case 'rescued':
      return <RescuedSlide recap={recap} />
    case 'tracks':
      return <TracksSlide recap={recap} />
    case 'artists':
      return <ArtistsSlide recap={recap} />
    case 'discoveries':
      return <DiscoveriesSlide recap={recap} />
    case 'when':
      return <WhenSlide recap={recap} />
    case 'together':
      return <TogetherSlide recap={recap} />
    case 'final':
      return <FinalSlide recap={recap} onOpenLibrary={onOpenLibrary} onClose={onClose} />
  }
}

// ---- слова, общие для слайдов ----

function sinceWord(recap: Recap): string {
  return `с ${dayMonth(recap.journalSince)}`
}

/** «ИТОГИ ГОДА · С 15 ОКТЯБРЯ», «ОКТЯБРЬ». */
function kickerOf(recap: Recap): string {
  if (recap.period.kind === 'month') return monthName(recap.period.month).toUpperCase()
  return recap.partial ? `ИТОГИ ГОДА · ${sinceWord(recap).toUpperCase()}` : 'ИТОГИ ГОДА'
}

function playsWord(count: number): string {
  return `${fmt(count)} ${plural(count, 'прослушивание', 'прослушивания', 'прослушиваний')}`
}

function topKicker(count: number): string {
  if (count >= 5) return 'ТОП-5 ТРЕКОВ'
  return ['ГЛАВНЫЙ ТРЕК', 'ГЛАВНЫЙ ТРЕК', 'ДВА ГЛАВНЫХ ТРЕКА', 'ТРИ ГЛАВНЫХ ТРЕКА', 'ЧЕТЫРЕ ГЛАВНЫХ ТРЕКА'][count] ?? 'ГЛАВНЫЕ ТРЕКИ'
}

function Logos({ track, size }: { track: RecapTrack; size: string }): JSX.Element {
  return (
    <span className="rs-row__logos" title={track.services.length > 1 ? 'Звучал из обоих сервисов' : undefined}>
      {track.services.map((service) => (
        <Logo key={service} service={service} size={size} />
      ))}
    </span>
  )
}

// ---- слайды ----

function CoverSlide({ recap }: { recap: Recap }): JSX.Element {
  const year = recap.period.year
  const mode = serviceMode(recap)
  const yearEnd = new Date(year + 1, 0, 1).getTime()
  const sub = recap.partial
    ? `${sinceWord(recap)[0]!.toUpperCase()}${sinceWord(recap).slice(1)} — с тех пор, как Duet ведёт журнал. ${
        recap.plays < MIN_PLAYS_FOR_HEAT
          ? `Пока это ${playsWord(recap.plays)}: история короткая, но ваша.`
          : `Это не целый год, а его последние ${monthsLeftWord(recap.journalSince, yearEnd)}.`
      }`
    : `1 января — ${dayMonth(recap.to)}. Всё, что звучало в Duet, — ${
        mode === 'both' ? 'из VK Музыки и Яндекс Музыки вместе' : `из ${SERVICE_NAME[onlyService(recap)]}`
      }.`
  return (
    <>
      <div className="rs-cover">
        <div className="rs-cover__text">
          <div className="rs-kicker">{kickerOf(recap)}</div>
          <h1 className="rs-h1">Ваш {year} в&nbsp;Duet</h1>
          <p className="rs-p">{sub}</p>
          {recap.partial && <div className="rs-pill">Первый год — неполный</div>}
        </div>
        <Fan
          covers={recap.tracks.slice(0, 3).map((track) => track.cover)}
          seed="cover"
          size="42cqmin"
          radius="3.4cqmin"
          className="rs-cover__fan"
        />
      </div>
      <div className="rs-hint">Нажмите справа или → — дальше</div>
    </>
  )
}

function MinutesSlide({ recap }: { recap: Recap }): JSX.Element {
  const month = recap.period.kind === 'month' ? recap.period.month : null
  const mode = serviceMode(recap)
  const allWave = mode === 'none' && recap.sources.wave > 0 && recap.sources.own === 0 && recap.sources.together === 0
  const tail = allWave ? ` — и всё из «Моей волны» ${onlyService(recap) === 'vk' ? 'VK' : 'Яндекса'}.` : '.'
  let note: string | null = null
  if (month && recap.previous) {
    const prevMonth = month === 1 ? 12 : month - 1
    const change = Math.round(((recap.minutes - recap.previous.minutes) / Math.max(1, recap.previous.minutes)) * 100)
    note =
      Math.abs(change) < 5
        ? `Примерно как в ${monthIn(prevMonth)}`
        : `На ${Math.abs(change)} % ${change > 0 ? 'больше' : 'меньше'}, чем в ${monthIn(prevMonth)}`
  } else if (recap.plays >= MIN_PLAYS_FOR_HEAT) {
    note = `${Math.round(recap.finishedShare * 100)} % прослушиваний — до самого конца`
  }
  return (
    <div className="rs-center">
      <div className="rs-kicker">{month ? `${monthName(month)} · сколько звучало` : 'СКОЛЬКО ЗВУЧАЛО'}</div>
      <div className="rs-number">
        <span className="rs-big">{fmt(recap.minutes)}</span>
        <span className="rs-unit">{plural(recap.minutes, 'минута', 'минуты', 'минут')}</span>
      </div>
      <p className="rs-lead">
        {compareMinutes(recap.minutes)}
        {tail}
      </p>
      {note && <div className="rs-note">{note}</div>}
    </div>
  )
}

function ServicesSlide({ recap }: { recap: Recap }): JSX.Element {
  const mode = serviceMode(recap)
  if (mode === 'both') {
    const share = serviceShares(recap)
    return (
      <div className="rs-svc">
        <div className="rs-col" style={{ gap: '2.4cqmin' }}>
          <div className="rs-kicker">VK И ЯНДЕКС</div>
          <h2 className="rs-h2">{share.vk >= share.yandex ? 'Чаще звучал VK' : 'Чаще звучал Яндекс'}</h2>
          <p className="rs-p" style={{ fontSize: '2.6cqmin', color: 'rgba(255,255,255,.76)' }}>
            Эту пропорцию не видит ни VK, ни Яндекс — только Duet, потому что играет из обоих.
          </p>
        </div>
        <div className="rs-col" style={{ gap: '3cqmin' }}>
          <Venn first={share.vk} second={share.yandex} colors={VENN_SERVICES} className="rs-svc__venn" />
          <div className="rs-svc__stats">
            <Stat label="VK Музыка" color="#66aaff" logo="vk" pct={`${share.vk} %`} sub={`${fmt(recap.services.vk)} мин`} />
            <Stat label="Яндекс Музыка" color="#ff7a7a" logo="yandex" pct={`${share.yandex} %`} sub={`${fmt(recap.services.yandex)} мин`} />
          </div>
        </div>
      </div>
    )
  }
  const total = Math.max(1, recap.sources.own + recap.sources.wave)
  const own = Math.round((recap.sources.own / total) * 100)
  const only = onlyService(recap)
  return (
    <div className="rs-svc">
      <div className="rs-col" style={{ gap: '2.4cqmin' }}>
        <div className="rs-kicker">ОТКУДА МУЗЫКА</div>
        <h2 className="rs-h2">{own >= 50 ? 'Чаще — ваши собственные списки' : 'Чаще — «Моя волна»'}</h2>
        <p className="rs-p" style={{ fontSize: '2.6cqmin', color: 'rgba(255,255,255,.76)' }}>
          Всё звучало из {SERVICE_NAME[only]}. Подключите {only === 'vk' ? 'Яндекс' : 'VK'} — и здесь появится доля
          каждого сервиса.
        </p>
      </div>
      <div className="rs-col" style={{ gap: '3cqmin' }}>
        <Venn first={own} second={100 - own} colors={VENN_SOURCES} className="rs-svc__venn" />
        <div className="rs-svc__stats">
          <Stat label="Свои списки" dot="#0a84ff" pct={`${own} %`} sub="плейлисты, «Нравится», альбомы" />
          <Stat label="Моя волна" dot="#e9e9ed" pct={`${100 - own} %`} sub="и волна по треку" />
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  color = '#f4f4f6',
  logo,
  dot,
  pct,
  sub
}: {
  label: string
  color?: string
  logo?: 'vk' | 'yandex'
  dot?: string
  pct: string
  sub: string
}): JSX.Element {
  return (
    <div className="rs-col">
      <div className="rs-stat__label" style={{ color }}>
        {logo && <Logo service={logo} size="2.6cqmin" />}
        {dot && <span className="rs-dot" style={{ background: dot }} />}
        <span>{label}</span>
      </div>
      <div className="rs-stat__pct">{pct}</div>
      <div className="rs-stat__sub">{sub}</div>
    </div>
  )
}

function RescuedSlide({ recap }: { recap: Recap }): JSX.Element {
  const rescued = recap.rescued!
  const direction = (from: 'vk' | 'yandex'): string => (from === 'vk' ? 'VK → Яндекс' : 'Яндекс → VK')
  return (
    <div className="rs-split">
      <div className="rs-col" style={{ gap: '2cqmin' }}>
        <div className="rs-kicker">СПАСЁННЫЕ ТРЕКИ</div>
        <div className="rs-big">{rescued.total}</div>
        <p className="rs-lead" style={{ fontSize: '3.3cqmin' }}>
          {plural(rescued.total, 'песня не играла', 'песни не играли', 'песен не играли')} в одном сервисе — Duet нашёл их
          во втором и включил оттуда.
        </p>
        <div className="rs-dirs">
          {rescued.vkToYandex > 0 && <Direction from="vk" to="yandex" count={rescued.vkToYandex} />}
          {rescued.yandexToVk > 0 && <Direction from="yandex" to="vk" count={rescued.yandexToVk} />}
        </div>
      </div>
      <div className="rs-col" style={{ gap: '1.4cqmin' }}>
        <div className="rs-kicker rs-kicker--small">НАПРИМЕР</div>
        {rescued.samples.map((track) => (
          <div key={track.id} className="rs-row rs-row--glass">
            <div className="rs-row__art">
              <Art url={track.cover} seed={track.title} />
            </div>
            <div className="rs-row__text">
              <div className="rs-row__title rs-truncate">{track.title}</div>
              <div className="rs-row__sub rs-truncate">{artistLine(track.artists)}</div>
            </div>
            <span className="rs-chip">{direction(track.from)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Direction({ from, to, count }: { from: 'vk' | 'yandex'; to: 'vk' | 'yandex'; count: number }): JSX.Element {
  const icon = (service: 'vk' | 'yandex'): JSX.Element => <Logo service={service} size="2.6cqmin" />
  return (
    <div className="rs-dir">
      {icon(from)}
      <span style={{ opacity: 0.6 }}>→</span>
      {icon(to)}
      <span>{count}</span>
    </div>
  )
}

function TracksSlide({ recap }: { recap: Recap }): JSX.Element {
  const limit = recap.period.kind === 'month' ? 3 : 5
  const list = recap.tracks.slice(0, limit)
  const [top, ...rest] = list
  if (!top) return <Empty />
  return (
    <div className="rs-top">
      <div className="rs-kicker">{recap.period.kind === 'month' && list.length >= 3 ? 'ТРИ ГЛАВНЫХ ТРЕКА' : topKicker(list.length)}</div>
      <div className="rs-top__grid">
        <div className="rs-top__lead">
          <div className="rs-top__art">
            <Art url={top.cover} seed={top.title} />
          </div>
          <div className="rs-top__title rs-clamp2">{top.title}</div>
          <div className="rs-top__artist rs-truncate">{artistLine(top.artists)}</div>
          <div className="rs-top__plays">
            <Logos track={top} size="2.6cqmin" />
            <span>{playsWord(top.plays)}</span>
          </div>
        </div>
        <div className="rs-rows">
          {rest.map((track, at) => (
            <div key={track.id} className="rs-row">
              <span className="rs-row__rank">{at + 2}</span>
              <div className="rs-row__art">
                <Art url={track.cover} seed={track.title} />
              </div>
              <div className="rs-row__text">
                <div className="rs-row__title rs-truncate">{track.title}</div>
                <div className="rs-row__sub rs-truncate">{artistLine(track.artists)}</div>
              </div>
              <span className="rs-row__num">{fmt(track.plays)}</span>
              <Logos track={track} size="2.6cqmin" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ArtistsSlide({ recap }: { recap: Recap }): JSX.Element {
  const [top, ...rest] = recap.artists
  if (!top) return <Empty />
  const month = recap.period.kind === 'month' ? recap.period.month : null
  const stats = `${playsWord(top.plays)} · ${top.tracks} ${plural(top.tracks, 'трек', 'трека', 'треков')}`
  // Рейтинг из пяти — когда есть из кого: иначе честно один главный.
  const solo = month !== null || rest.length < 2 || recap.plays < MIN_PLAYS_FOR_HEAT

  if (solo) {
    let note = 'Остальные пока звучали реже. Рейтинг появится, когда музыки станет больше.'
    if (month) {
      const streak = recap.previous?.artistStreak ?? 1
      const prev = recap.previous?.topArtist
      const ordinals = ['', '', 'Второй', 'Третий', 'Четвёртый', 'Пятый', 'Шестой', 'Седьмой', 'Восьмой', 'Девятый', 'Десятый', 'Одиннадцатый']
      note =
        streak >= 2
          ? `${ordinals[streak] ?? `${streak}-й`} месяц подряд — первое место.`
          : prev && prev !== top.name
            ? `В ${monthIn(month === 1 ? 12 : month - 1)} первым был ${prev}.`
            : 'Больше всех прослушиваний за месяц.'
    }
    return (
      <div className="rs-solo">
        <Fan covers={top.covers} seed={top.name} size="40cqmin" radius="3.4cqmin" />
        <div className="rs-col" style={{ gap: '2.2cqmin', flex: 1 }}>
          <div className="rs-kicker">{month ? 'ИСПОЛНИТЕЛЬ МЕСЯЦА' : 'ГЛАВНЫЙ ИСПОЛНИТЕЛЬ'}</div>
          <div className="rs-solo__name">{top.name}</div>
          <div style={{ fontSize: '3cqmin' }}>{stats}</div>
          <p className="rs-p" style={{ fontSize: '2.3cqmin', color: 'rgba(255,255,255,.7)', maxWidth: '60cqmin' }}>
            {note}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rs-top">
      <div className="rs-kicker">{recap.artists.length >= 5 ? 'ТОП-5 ИСПОЛНИТЕЛЕЙ' : 'ГЛАВНЫЕ ИСПОЛНИТЕЛИ'}</div>
      <div className="rs-top__grid" style={{ gap: '7cqmin' }}>
        <div className="rs-top__lead" style={{ width: '34cqmin' }}>
          <Fan covers={top.covers} seed={top.name} size="30cqmin" radius="2.8cqmin" className="rs-artist__fan" />
          <div style={{ height: '3cqmin' }} />
          <div className="rs-artist__name">{top.name}</div>
          <div className="rs-artist__stats">{stats}</div>
        </div>
        <div className="rs-rows">
          {rest.map((artist, at) => (
            <div key={artist.name} className="rs-row" style={{ padding: '1.4cqmin 1.8cqmin 1.4cqmin 1.2cqmin', gap: '2.2cqmin' }}>
              <span className="rs-row__rank">{at + 2}</span>
              <Fan covers={artist.covers.slice(0, 2)} seed={artist.name} size="7.4cqmin" radius="1.3cqmin" />
              <div className="rs-row__text" style={{ marginLeft: '1cqmin' }}>
                <div className="rs-row__title rs-truncate" style={{ fontSize: '2.8cqmin' }}>
                  {artist.name}
                </div>
                <div className="rs-row__sub">
                  {artist.tracks} {plural(artist.tracks, 'трек', 'трека', 'треков')}
                </div>
              </div>
              <span className="rs-row__num">{fmt(artist.plays)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DiscoveriesSlide({ recap }: { recap: Recap }): JSX.Element {
  const found = recap.discoveries!
  const top = found.top!
  const year = recap.period.kind === 'year'
  const one = found.count % 10 === 1 && found.count % 100 !== 11
  return (
    <div className="rs-split" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)' }}>
      <div className="rs-col" style={{ gap: '2cqmin' }}>
        <div className="rs-kicker">{year ? 'ОТКРЫТИЯ ГОДА' : 'НОВОЕ В ЭТОМ МЕСЯЦЕ'}</div>
        <div className="rs-big">{found.count}</div>
        <p className="rs-lead" style={{ fontSize: '3.4cqmin' }}>
          {plural(found.count, 'исполнитель', 'исполнителя', 'исполнителей')} впервые {one ? 'зазвучал' : 'зазвучали'} у вас
          в этом {year ? 'году' : 'месяце'}
        </p>
      </div>
      <div className="rs-disc rs-glass">
        <Fan covers={top.covers} seed={top.name} size="24cqmin" radius="2.4cqmin" className="rs-disc__fan" />
        <div style={{ height: '2.4cqmin' }} />
        <div className="rs-kicker rs-kicker--small">ВЫШЕ ВСЕХ ИЗ НОВЫХ</div>
        <div className="rs-disc__name">{top.name}</div>
        <div className="rs-artist__stats" style={{ fontSize: '2.3cqmin' }}>
          {top.rank}-е место за {year ? 'год' : 'месяц'} · впервые {dayMonth(top.firstAt)}
        </div>
      </div>
    </div>
  )
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function WhenSlide({ recap }: { recap: Recap }): JSX.Element {
  const max = Math.max(1, ...recap.heat.flat())
  const night = recap.night
  return (
    <div className="rs-when">
      <div className="rs-kicker">КОГДА ВЫ СЛУШАЕТЕ</div>
      <h2 className="rs-h2">{whenTitle(recap.heat)}</h2>
      <div className="rs-when__body">
        <div className="rs-heat">
          {recap.heat.map((row, day) => (
            <div key={day} className="rs-heat__row">
              <span>{DAYS[day]}</span>
              {row.map((minutes, hour) => (
                <div
                  key={hour}
                  className="rs-heat__cell"
                  title={`${DAYS[day]}, ${hour}:00 — ${minutes} мин`}
                  style={{ background: `rgba(255,255,255,${(0.07 + Math.sqrt(minutes / max) * 0.83).toFixed(2)})` }}
                />
              ))}
            </div>
          ))}
          <div className="rs-heat__row rs-heat__hours" style={{ marginTop: '0.6cqmin' }}>
            <span />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour}>{hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}</span>
            ))}
          </div>
        </div>
        {night && (
          <div className="rs-night rs-glass">
            <div className="rs-kicker rs-kicker--small" style={{ fontSize: '1.8cqmin' }}>
              САМЫЙ НОЧНОЙ ТРЕК
            </div>
            <div className="rs-night__art">
              <Art url={night.cover} seed={night.title} />
            </div>
            <div className="rs-night__title rs-clamp2">{night.title}</div>
            <div className="rs-row__sub">{artistLine(night.artists)}</div>
            <div className="rs-row__sub" style={{ fontSize: '2cqmin' }}>
              {night.nightPlays} {plural(night.nightPlays, 'раз', 'раза', 'раз')} между 0:00 и 5:00
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TogetherSlide({ recap }: { recap: Recap }): JSX.Element {
  const together = recap.together!
  const hours = Math.round(together.minutes / 60)
  const big = hours >= 1 ? hours : together.minutes
  const unit = hours >= 1 ? plural(hours, 'час', 'часа', 'часов') : plural(together.minutes, 'минута', 'минуты', 'минут')
  const names = together.people.map((person) => person.name)
  // Имена склонять не беремся: «с Аней» из «Аня» не выведешь надёжно.
  const withLine =
    names.length === 0 ? null : names.length === 1 ? `Чаще всего с вами слушал(а) ${names[0]}` : `Чаще всего с вами: ${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
  return (
    <div className="rs-center">
      <div className="rs-kicker">ВМЕСТЕ</div>
      <div className="rs-number">
        <span className="rs-big">{big}</span>
        <span className="rs-unit">{unit}</span>
      </div>
      <p className="rs-lead">в Duet Jam и «Слушать вместе»</p>
      {withLine && (
        <div className="rs-people">
          <div className="rs-people__faces">
            {names.map((name) => (
              <div key={name} className="rs-face" style={{ background: faceBackground(name) }}>
                {name[0]?.toUpperCase()}
              </div>
            ))}
          </div>
          <div style={{ fontSize: '3cqmin', fontWeight: 600, marginLeft: '1.6cqmin' }}>{withLine}</div>
        </div>
      )}
      <div className="rs-note" style={{ fontSize: '2.1cqmin', marginTop: '1.6cqmin' }}>
        Имена видны только вам — на картинку для соцсетей они не попадут.
      </div>
    </div>
  )
}

function FinalSlide({
  recap,
  onOpenLibrary,
  onClose
}: {
  recap: Recap
  onOpenLibrary: () => void
  onClose: () => void
}): JSX.Element {
  const [format, setFormat] = useState<RecapCardFormat>('story')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [playlist, setPlaylist] = useState<'idle' | 'busy' | 'done'>('idle')

  const period = recap.period
  const month = period.kind === 'month' ? period.month : null
  const top = recap.tracks[0]
  const artist = recap.artists[0]
  const mode = serviceMode(recap)
  const share = serviceShares(recap)
  const label = month ? 'МЕСЯЦА' : recap.partial ? '' : 'ГОДА'

  const facts: { k: string; v: string; s: string }[] = [
    { k: 'МИНУТ', v: fmt(recap.minutes), s: shortMinutes(recap.minutes) },
    mode === 'both'
      ? { k: 'VK И ЯНДЕКС', v: `${share.vk} / ${share.yandex} %`, s: 'доля времени' }
      : mode === 'source'
        ? {
            k: 'ОТКУДА',
            v: onlyService(recap) === 'vk' ? 'VK Музыка' : 'Яндекс Музыка',
            s: `${Math.round((recap.sources.own / Math.max(1, recap.sources.own + recap.sources.wave)) * 100)} % — свои списки`
          }
        : { k: 'ПРОСЛУШИВАНИЙ', v: fmt(recap.plays), s: recap.sources.own === 0 ? 'всё — из «Моей волны»' : 'за это время' },
    {
      k: label ? `ТРЕК ${label}` : 'ГЛАВНЫЙ ТРЕК',
      v: top?.title ?? '—',
      s: top ? `${artistLine(top.artists)} · ${top.plays} ${plural(top.plays, 'раз', 'раза', 'раз')}` : ''
    },
    {
      k: label ? `ИСПОЛНИТЕЛЬ ${label}` : 'ГЛАВНЫЙ ИСПОЛНИТЕЛЬ',
      v: artist?.name ?? '—',
      s: artist ? playsWord(artist.plays) : ''
    }
  ]

  const title = month
    ? `Таким был ваш ${monthName(month)}`
    : recap.partial
      ? 'Хорошее начало'
      : `Таким был ваш ${period.year}`
  const kicker = month
    ? `ВАШ ${monthName(month).toUpperCase()} В DUET`
    : recap.partial
      ? `ВАШ ${period.year} В DUET · ${sinceWord(recap).toUpperCase()}`
      : `ВАШ ${period.year} В DUET`
  const count = recap.tracks.length
  const hint =
    count < 50
      ? `${count} ${plural(count, 'трек', 'трека', 'треков')} — всё, что вы успели послушать${recap.partial ? ` ${sinceWord(recap)}` : ''}.`
      : mode === 'both'
        ? `50 треков ${month ? 'месяца' : 'года'} из VK и Яндекса — в одном плейлисте Duet.`
        : '50 главных треков — одним плейлистом Duet.'

  const run = async (action: () => Promise<boolean>, done: string): Promise<void> => {
    setBusy(true)
    setStatus('Рисуем картинку…')
    try {
      setStatus((await action()) ? done : null)
    } catch {
      setStatus('Не получилось — попробуйте ещё раз')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rs-final">
      <div className="rs-col" style={{ gap: '2.2cqmin' }}>
        <div className="rs-kicker">{kicker}</div>
        <h2 className="rs-h2" style={{ marginBottom: '1cqmin' }}>
          {title}
        </h2>
        <div className="rs-facts">
          {facts.map((fact) => (
            <div key={fact.k} className="rs-fact rs-glass">
              <div className="rs-fact__k">{fact.k}</div>
              <div className="rs-fact__v rs-truncate">{fact.v}</div>
              <div className="rs-fact__s rs-truncate">{fact.s}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="rs-share" onClick={stop}>
        <div className="rs-seg">
          <button aria-pressed={format === 'story'} onClick={() => setFormat('story')}>
            Для историй
          </button>
          <button aria-pressed={format === 'post'} onClick={() => setFormat('post')}>
            Для поста
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="rs-btn rs-btn--primary"
            disabled={busy}
            onClick={() => void run(() => window.shell.recapSave(period, format), 'Картинка сохранена')}
          >
            <Download size={15} />
            Сохранить картинку
          </button>
          <button
            className="rs-btn"
            disabled={busy}
            onClick={() => void run(() => window.shell.recapCopy(period, format), 'Скопировано — вставьте в чат или историю')}
          >
            Скопировать
          </button>
        </div>
        {status && <div className="rs-share__hint">{status}</div>}
        <div className="rs-share__line" />
        {playlist === 'done' ? (
          <button
            className="rs-btn rs-btn--small"
            onClick={() => {
              onClose()
              onOpenLibrary()
            }}
          >
            <PlaylistAdd size={15} />
            Готово — открыть «Мою коллекцию»
          </button>
        ) : (
          <button
            className="rs-btn rs-btn--small"
            disabled={playlist === 'busy'}
            onClick={() => {
              setPlaylist('busy')
              void window.shell.recapPlaylist(period).then((id) => setPlaylist(id ? 'done' : 'idle'))
            }}
          >
            <PlaylistAdd size={15} />
            Собрать плейлист «Топ {month ? 'месяца' : 'года'}»
          </button>
        )}
        <div className="rs-share__hint">{hint}</div>
      </div>
    </div>
  )
}
