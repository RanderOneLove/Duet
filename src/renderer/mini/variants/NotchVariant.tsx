import { currentTrack } from '@shared/player'
import { formatTime, ratio } from '../../shared/format'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { ServiceLogo } from '../../shared/ServiceLogo'
import { Eq } from '../../shared/Eq'
import { Heart, HeartOff, Next, Pause, Play, Prev, Volume } from '../../shared/Icons'
import { SeekBar } from '../../shell/components/SeekBar'
import { Cover } from '../../shell/components/Cover'
import { artist, title, type VariantProps } from './shared'
import { NOTCH, PAD, contextLabel, useEdgeState, useHeldState, useQuiet, useReportEdge, isShrinking } from './edge'

/**
 * Шторка сверху (макет 3a).
 *
 * Чёрная форма, сросшаяся с верхним краем экрана. В покое — полоска шириной в
 * пару сантиметров, которую не замечаешь, пока не ищешь. Подержишь курсор —
 * раскрывается в плеер; сменится трек — на пару секунд выглядывает строкой
 * «что заиграло».
 *
 * Форма закреплена к верхнему краю окна, а не лежит в потоке: окно меняет
 * размер позже, чем меняется разметка, и при обычной вёрстке форма на кадр
 * съезжала бы, пока система догоняет. Так она стоит на месте при любом окне.
 */
export function NotchVariant({
  player,
  settings,
  expanded,
  onCommand,
  onToggleExpand,
  onRestore,
  onEdge
}: VariantProps): JSX.Element {
  const track = currentTrack(player)
  const quiet = useQuiet(settings)
  const state = useEdgeState(expanded, track?.id ?? null, settings.notchPeek)
  const held = useHeldState(state, quiet)
  const position = useSmoothPosition(player)

  const shape = NOTCH[state]
  const frame = NOTCH[held]
  const place = settings.notchPlace

  // Окно: форма плюс постоянный запас по бокам под ушки. Вниз — ничего.
  const frameStyle = { width: frame.w + PAD * 2, height: frame.h }
  const hitX =
    place === 'left'
      ? PAD
      : place === 'right'
        ? frameStyle.width - PAD - shape.w
        : Math.round((frameStyle.width - shape.w) / 2)
  useReportEdge(onEdge, {
    hit: { x: hitX, y: 0, width: shape.w, height: shape.h },
    interactive: state === 'open'
  })
  const anchor =
    place === 'left' ? { left: PAD } : place === 'right' ? { right: PAD } : { left: '50%', translate: '-50% 0' }

  const left = Math.max(0, player.durationMs - position)

  return (
    <div className="edge edge--notch" style={frameStyle} data-state={state} data-dir={isShrinking(state, held) ? 'shrink' : 'grow'}>
      <div
        className="edge__shape"
        style={{ ...anchor, width: shape.w, height: shape.h, ['--r' as string]: `${shape.r}px`, ['--e' as string]: `${shape.e}px` }}
        onDoubleClick={onToggleExpand}
      >
        <span className="edge__ear edge__ear--tl" />
        <span className="edge__ear edge__ear--tr" />
        <div className="edge__body">
          {/* Всплывание: одна строка о том, что заиграло. */}
          <div className="notch__peek" aria-hidden={state !== 'peek'}>
            <Cover url={track?.coverUrl} seed={track?.title ?? 'duet'} className="notch__peekart" />
            <span className="truncate notch__peektext">
              <b>{title(player)}</b>
              <span className="notch__peekartist"> · {artist(player)}</span>
            </span>
            {track && <ServiceLogo service={track.service} size={14} />}
            <Eq playing={player.playing} height={12} bar={2.5} />
          </div>

          {/* Раскрытый плеер. */}
          <div className="notch__open" aria-hidden={state !== 'open'}>
            <div className="notch__top">
              {/* Обложка открывает приложение: в шторке нет своей кнопки «развернуть»,
                  а тянуться за ним в трей ради одного щелчка незачем. */}
              <button className="notch__artbtn" title="Открыть Duet" onClick={onRestore}>
                <Cover url={track?.coverUrl} seed={track?.title ?? 'duet'} className="notch__art" />
              </button>
              <div className="notch__meta">
                <div className="notch__kicker">
                  {track && <ServiceLogo service={track.service} size={13} />}
                  <span className="truncate">
                    {/* Коротко, как в макете: полное «Яндекс.Музыка» здесь — шум. */}
                    {track ? `${track.service === 'vk' ? 'VK' : 'Яндекс'} · ${contextLabel(player)}` : 'Duet'}
                  </span>
                </div>
                <div className="truncate notch__title">{title(player)}</div>
                <div className="truncate notch__artist">{artist(player)}</div>
              </div>
              <Eq playing={player.playing} height={18} bar={2.5} className="notch__eq" />
            </div>

            <div className="notch__seekrow">
              <span className="notch__time">{formatTime(position)}</span>
              <SeekBar
                ratio={ratio(player.durationMs, position)}
                seekable={player.durationMs > 0}
                className="edge__seek"
                onSeek={(value) => onCommand({ type: 'seek', positionMs: value * player.durationMs })}
              />
              <span className="notch__time notch__time--end">-{formatTime(left)}</span>
            </div>

            <div className="notch__controls">
              {player.canDislike ? (
                <button
                  className="edge__round"
                  title="Не нравится"
                  disabled={!track}
                  onClick={() => onCommand({ type: 'dislike' })}
                >
                  <HeartOff size={15} />
                </button>
              ) : (
                <span className="edge__round edge__round--spacer" />
              )}

              <div className="notch__transport">
                <button className="edge__skip" title="Предыдущий" disabled={!track} onClick={() => onCommand({ type: 'prev' })}>
                  <Prev size={19} />
                </button>
                <button
                  className="edge__play"
                  title={player.playing ? 'Пауза' : 'Воспроизвести'}
                  disabled={!track}
                  onClick={() => onCommand({ type: 'playPause' })}
                >
                  {player.playing ? <Pause size={17} /> : <Play size={17} />}
                </button>
                <button className="edge__skip" title="Следующий" disabled={!track} onClick={() => onCommand({ type: 'next' })}>
                  <Next size={19} />
                </button>
              </div>

              <button
                className={`edge__round ${track?.liked ? 'edge__round--liked' : ''}`}
                title={track?.liked ? 'Убрать из избранного' : 'В избранное'}
                disabled={!track}
                onClick={() => onCommand({ type: 'toggleLike' })}
              >
                <Heart size={15} />
              </button>

              {settings.notchVolume && (
                <div className="notch__volume">
                  <Volume size={13} />
                  <SeekBar
                    ratio={player.muted ? 0 : player.volume}
                    seekable={true}
                    className="edge__seek notch__volbar"
                    onSeek={(value) => onCommand({ type: 'setVolume', volume: value })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
