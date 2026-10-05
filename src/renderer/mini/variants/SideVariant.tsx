import { currentTrack } from '@shared/player'
import { formatTime, ratio } from '../../shared/format'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { ServiceLogo } from '../../shared/ServiceLogo'
import { Eq } from '../../shared/Eq'
import { Heart, HeartOff, Next, Pause, Play, Prev, Volume } from '../../shared/Icons'
import { SeekBar } from '../../shell/components/SeekBar'
import { VolumeSlider } from '../../shell/components/VolumeSlider'
import { Cover } from '../../shell/components/Cover'
import { artist, title, type VariantProps } from './shared'
import { PAD, SIDE_MIN_FRAME, sideShape, useEdgeState, useHeldState, useQuiet, useReportEdge, isShrinking } from './edge'

/**
 * Язычок сбоку (макет 3b).
 *
 * Та же мысль, что у шторки, но вдоль бокового края: в покое — узкая
 * вертикальная полоска посреди края, при наведении выезжает колонкой плеера,
 * при смене трека выглядывает обложкой. Колонка, а не строка: сбоку тянуться
 * вниз есть куда, а вбок — нет, там уже рабочее окно.
 */
export function SideVariant({
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
  const right = settings.sideEdge !== 'left'

  const shape = sideShape(state, settings.notchVolume)
  const frame = sideShape(held, settings.notchVolume)

  // Окно: форма плюс запас сверху и снизу под ушки. Внутрь экрана — ничего.
  const frameStyle = {
    width: Math.max(SIDE_MIN_FRAME, frame.w),
    height: frame.h + PAD * 2
  }
  useReportEdge(onEdge, {
    hit: {
      x: right ? frameStyle.width - shape.w : 0,
      y: Math.round((frameStyle.height - shape.h) / 2),
      width: shape.w,
      height: shape.h
    },
    interactive: state === 'open'
  })
  const anchor = { [right ? 'right' : 'left']: 0, top: '50%', translate: '0 -50%' }

  return (
    <div className={`edge edge--side ${right ? 'edge--right' : 'edge--left'}`} style={frameStyle} data-state={state} data-dir={isShrinking(state, held) ? 'shrink' : 'grow'}>
      <div
        className="edge__shape"
        style={{ ...anchor, width: shape.w, height: shape.h, ['--r' as string]: `${shape.r}px`, ['--e' as string]: `${shape.e}px` }}
        onDoubleClick={onToggleExpand}
      >
        <span className="edge__ear edge__ear--top" />
        <span className="edge__ear edge__ear--bottom" />
        <div className="edge__body">
          <div className="side__peek" aria-hidden={state !== 'peek'}>
            <Cover url={track?.coverUrl} seed={track?.title ?? 'duet'} className="side__peekart" />
            <Eq playing={player.playing} height={13} bar={2.5} />
            {track && <ServiceLogo service={track.service} size={13} />}
          </div>

          <div className="side__open" aria-hidden={state !== 'open'}>
            <button className="side__artbtn" title="Открыть Duet" onClick={onRestore}>
              <Cover url={track?.coverUrl} seed={track?.title ?? 'duet'} className="side__art" />
              {track && (
                <span className="side__badge">
                  <ServiceLogo service={track.service} size={16} />
                </span>
              )}
            </button>

            <div className="side__meta">
              <div className="side__title">{title(player)}</div>
              <div className="truncate side__artist">{artist(player)}</div>
            </div>

            <div className="side__progress">
              <SeekBar
                ratio={ratio(player.durationMs, position)}
                seekable={player.durationMs > 0}
                className="edge__seek"
                onSeek={(value) => onCommand({ type: 'seek', positionMs: value * player.durationMs })}
              />
              <div className="side__times">
                <span>{formatTime(position)}</span>
                <span>{formatTime(player.durationMs)}</span>
              </div>
            </div>

            <div className="side__transport">
              <button className="edge__skip" title="Предыдущий" disabled={!track} onClick={() => onCommand({ type: 'prev' })}>
                <Prev size={19} />
              </button>
              <button
                className="edge__play edge__play--sm"
                title={player.playing ? 'Пауза' : 'Воспроизвести'}
                disabled={!track}
                onClick={() => onCommand({ type: 'playPause' })}
              >
                {player.playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button className="edge__skip" title="Следующий" disabled={!track} onClick={() => onCommand({ type: 'next' })}>
                <Next size={19} />
              </button>
            </div>

            <div className="side__marks">
              {player.canDislike && (
                <button
                  className="edge__round edge__round--fill"
                  title="Не нравится"
                  disabled={!track}
                  onClick={() => onCommand({ type: 'dislike' })}
                >
                  <HeartOff size={15} />
                </button>
              )}
              <button
                className={`edge__round edge__round--fill ${track?.liked ? 'edge__round--liked' : ''}`}
                title={track?.liked ? 'Убрать из избранного' : 'В избранное'}
                disabled={!track}
                onClick={() => onCommand({ type: 'toggleLike' })}
              >
                <Heart size={15} />
              </button>
            </div>

            {/* Громкость — столбиком: вверх громче, как у всех ползунков в
                колонке, и пальцу есть куда тянуть. */}
            {settings.notchVolume && (
              <div className="side__volume" title={`Громкость ${Math.round((player.muted ? 0 : player.volume) * 100)}%`}>
                <VolumeSlider
                  value={player.muted ? 0 : player.volume}
                  onChange={(value) => onCommand({ type: 'setVolume', volume: value })}
                />
                <span className="side__volicon">
                  <Volume size={16} />
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
