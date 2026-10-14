import { useEffect, useState } from 'react'
import type { Recap, RecapCardFormat, RecapPeriod } from '@shared/recap'
import {
  Art,
  Logo,
  RecapBg,
  SERVICE_NAME,
  VENN_SERVICES,
  Venn,
  artistLine,
  dayMonth,
  fmt,
  monthName,
  onlyService,
  plural,
  serviceShares
} from './RecapParts'

/**
 * Карточка итогов для соцсетей: 1080×1920 для историй и 1200×630 для поста.
 *
 * Одна цифра, доля сервисов и три трека — читается за две секунды. Имён из
 * Jam здесь нет: карточку отправляют наружу. Внизу мелко — марка и адрес,
 * чтобы каждая карточка заодно показывала Duet тем, кто о нём не слышал.
 * У историй сверху и снизу по ~250 пикселей закрывает интерфейс соцсети —
 * там нет ничего важного.
 */
export function RecapCard({ recap, format }: { recap: Recap; format: RecapCardFormat }): JSX.Element {
  const period = recap.period
  const month = period.kind === 'month' ? period.month : null
  const both = recap.services.vk > 0 && recap.services.yandex > 0
  const share = serviceShares(recap)
  const top = recap.tracks.slice(0, 3)
  const artist = recap.artists[0]
  const story = format === 'story'

  const kicker = month ? `МОЙ ${monthName(month).toUpperCase()} В DUET` : `МОЙ ${period.year} В DUET`
  const periodText = month
    ? `${monthName(month)[0]!.toUpperCase()}${monthName(month).slice(1)} ${period.year}`
    : recap.partial
      ? `с ${dayMonth(recap.journalSince)} — первые месяцы`
      : `1 января — ${dayMonth(recap.to)}`
  const unit = `${plural(recap.minutes, 'минута', 'минуты', 'минут')} музыки`
  const topLabel = top.length >= 3 ? 'ТРИ ГЛАВНЫХ ТРЕКА' : top.length === 2 ? 'ДВА ГЛАВНЫХ ТРЕКА' : 'ГЛАВНЫЙ ТРЕК'
  const artistLabel = month ? 'Исполнитель месяца' : recap.partial ? 'Главный исполнитель' : 'Исполнитель года'
  const only = onlyService(recap)

  const s = story
    ? { pad: 96, kicker: 30, big: 250, unit: 64, venn: 200, line: 40, logo: 46, label: 26, rank: 40, art: 124, title: 42, sub: 30, artist: 32, mark: 48, brand: 30, url: 22 }
    : { pad: 60, kicker: 18, big: 150, unit: 34, venn: 104, line: 21, logo: 26, label: 16, rank: 24, art: 84, title: 25, sub: 18, artist: 0, mark: 30, brand: 19, url: 14 }

  const shares = both ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: story ? 34 : 20 }}>
      <Venn first={share.vk} second={share.yandex} colors={VENN_SERVICES} style={{ width: s.venn, height: s.venn * 0.585, flex: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 12 : 4 }}>
        {(['vk', 'yandex'] as const).map((service) => (
          <div key={service} style={{ display: 'flex', alignItems: 'center', gap: story ? 16 : 10, fontSize: s.line, fontWeight: 600 }}>
            <Logo service={service} size={s.line * 1.1} />
            <span>{service === 'vk' ? 'VK' : 'Яндекс'}</span>
            <span style={{ fontFamily: "'Onest', sans-serif", fontWeight: 800 }}>{share[service]} %</span>
          </div>
        ))}
      </div>
    </div>
  ) : (
    <div style={{ display: 'flex', alignItems: 'center', gap: story ? 18 : 12, fontSize: story ? 40 : 22, fontWeight: 600 }}>
      <Logo service={only} size={story ? 48 : 26} />
      <span>Всё — из {SERVICE_NAME[only]}</span>
    </div>
  )

  const tracks = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 22 : 16, minWidth: 0 }}>
      <div style={{ fontSize: s.label, fontWeight: 600, letterSpacing: '.1em', color: 'rgba(255,255,255,.72)' }}>{topLabel}</div>
      {top.map((track, at) => (
        <div key={track.id} style={{ display: 'flex', alignItems: 'center', gap: story ? 28 : 18 }}>
          <span style={{ width: story ? 36 : 22, font: `800 ${s.rank}px/1 'Onest',sans-serif`, color: 'rgba(255,255,255,.6)', flex: 'none' }}>
            {at + 1}
          </span>
          <div
            className="recapcard__art"
            style={{ width: s.art, height: s.art, borderRadius: story ? 18 : 12, boxShadow: '0 10px 30px rgba(0,0,0,.4)' }}
          >
            <Art url={track.cover} seed={track.title} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="rs-truncate" style={{ fontSize: s.title, fontWeight: 600, lineHeight: 1.15 }}>
              {track.title}
            </div>
            <div className="rs-truncate" style={{ fontSize: s.sub, color: 'rgba(255,255,255,.74)', marginTop: 4 }}>
              {artistLine(track.artists)}
            </div>
          </div>
          <Logo service={track.service} size={s.logo} />
        </div>
      ))}
      {story && artist && (
        <div style={{ fontSize: s.artist, marginTop: 14 }}>
          <span style={{ color: 'rgba(255,255,255,.72)' }}>{artistLabel} — </span>
          <b style={{ fontWeight: 600 }}>{artist.name}</b>
        </div>
      )}
    </div>
  )

  const brand = (
    <div style={{ display: 'flex', alignItems: 'center', gap: story ? 16 : 11, color: 'rgba(255,255,255,.8)' }}>
      <svg width={s.mark} height={s.mark * 0.69} viewBox="0 0 115 80" aria-hidden={true}>
        <circle cx="40" cy="40" r="40" fill="#0a84ff" />
        <circle cx="75" cy="40" r="40" fill="#e9e9ed" />
        <path d="M57.5 4.03A40 40 0 0 1 57.5 75.97A40 40 0 0 1 57.5 4.03Z" fill="#7fa9f5" />
      </svg>
      <span style={{ font: `800 ${s.brand}px/1 'Onest',sans-serif`, color: '#fff', letterSpacing: '-.02em' }}>Duet</span>
      <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: s.url }}>randeronelove.github.io/Duet</span>
    </div>
  )

  const head = (
    <div>
      <div style={{ fontSize: s.kicker, fontWeight: 600, letterSpacing: '.1em', color: 'rgba(255,255,255,.8)' }}>{kicker}</div>
      <div style={{ fontSize: s.kicker, color: 'rgba(255,255,255,.74)', marginTop: story ? 10 : 6 }}>{periodText}</div>
    </div>
  )

  const number = (
    <div>
      <div style={{ font: `800 ${s.big}px/.86 'Onest',sans-serif`, letterSpacing: '-.055em' }}>{fmt(recap.minutes)}</div>
      <div style={{ font: `700 ${s.unit}px/1 'Onest',sans-serif`, letterSpacing: '-.03em', marginTop: story ? 22 : 14 }}>{unit}</div>
      <div style={{ marginTop: story ? 56 : 30 }}>{shares}</div>
    </div>
  )

  const size = story ? { width: 1080, height: 1920 } : { width: 1200, height: 630 }
  return (
    <div className={`recapcard recapcard--${format}`} style={size}>
      <RecapBg cover={top[0]?.cover ?? null} seed={top[0]?.title ?? 'duet'} />
      {story ? (
        <div
          style={{
            position: 'absolute',
            left: s.pad,
            right: s.pad,
            top: 300,
            bottom: 300,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}
        >
          {head}
          {number}
          {tracks}
          {brand}
        </div>
      ) : (
        <>
          <div
            style={{
              position: 'absolute',
              left: 60,
              right: 60,
              top: 56,
              bottom: 100,
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
              gap: 60
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {head}
              <div style={{ flex: 1 }} />
              {number}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>{tracks}</div>
          </div>
          <div style={{ position: 'absolute', left: 60, bottom: 40 }}>{brand}</div>
        </>
      )}
    </div>
  )
}

/**
 * Страница одной карточки — её открывает главный процесс в невидимом окне,
 * дожидается обложек и шрифтов и снимает.
 */
export function RecapCardPage(): JSX.Element {
  const params = new URLSearchParams(location.search)
  const format = (params.get('card') === 'post' ? 'post' : 'story') as RecapCardFormat
  const period = JSON.parse(params.get('period') ?? '{}') as RecapPeriod
  const [recap, setRecap] = useState<Recap | null>(null)

  useEffect(() => {
    document.body.classList.add('is-card')
    void window.shell.recap(period).then(setRecap)
  }, [])

  useEffect(() => {
    if (!recap) return
    let dropped = false
    void (async () => {
      await document.fonts.ready
      // Картинки: каждой дать загрузиться или упасть — подставная обложка тоже годится.
      const images = [...document.images]
      await Promise.all(
        images.map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true })
                image.addEventListener('error', () => resolve(), { once: true })
              })
        )
      )
      // Размытый фон — тоже картинка, но через CSS; её ждём отдельно.
      const cover = recap.tracks[0]?.cover
      if (cover) {
        await new Promise<void>((resolve) => {
          const probe = new Image()
          probe.onload = () => resolve()
          probe.onerror = () => resolve()
          probe.src = cover
        })
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (!dropped) window.shell.recapCardReady()
    })()
    return () => {
      dropped = true
    }
  }, [recap])

  return recap ? <RecapCard recap={recap} format={format} /> : <div />
}
