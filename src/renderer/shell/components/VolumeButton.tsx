import type { PlayerState } from '@shared/player'
import { Volume } from '../../shared/Icons'
import { useMediaQuery } from '../../shared/useMediaQuery'
import { Popover } from './Popover'
import { VolumeSlider } from './VolumeSlider'

interface Props {
  state: PlayerState
  align?: 'up' | 'down'
}

/**
 * Ширина окна позволяет — обычная полоска в ряду.
 *
 * Тот же порог, по которому плита и так прячет подписи кнопок: пока места
 * хватает, громкость — это ползунок, до которого один жест, а не кнопка,
 * которую надо сперва раскрыть.
 */
const ROOM_FOR_SLIDER = '(min-width: 1280px)'

/**
 * Громкость: полоской, когда есть место, и кнопкой, когда его нет.
 *
 * Ползунок во всю ширину хорош, пока окно широкое; в узком он первым уезжает
 * за край, а вместе с ним съезжает весь ряд. Кнопка занимает столько же,
 * сколько любая другая, а ползунок появляется над ней — вертикальный, потому
 * что тянуть вверх в узком окне есть куда, а вбок уже нет. И раскрывается она
 * по наведению: за громкостью тянутся движением, а не заходом через щелчок.
 */
export function VolumeButton({ state, align = 'up' }: Props): JSX.Element {
  const level = state.muted ? 0 : state.volume
  const roomy = useMediaQuery(ROOM_FOR_SLIDER)
  const setVolume = (value: number): void => {
    window.shell.command({ type: 'setVolume', volume: value })
  }

  if (roomy) {
    return (
      <div className="dock__volume" title={`Громкость ${Math.round(level * 100)}%`}>
        <button
          className={`togglebtn ${state.muted ? 'togglebtn--on' : ''}`}
          title={state.muted ? 'Включить звук' : 'Выключить звук'}
          onClick={() => window.shell.command({ type: 'toggleMute' })}
        >
          <Volume size={15} />
        </button>
        <VolumeSlider value={level} onChange={setVolume} horizontal />
      </div>
    )
  }

  return (
    <Popover
      icon={<Volume size={15} />}
      title={`Громкость ${Math.round(level * 100)}%`}
      align={align}
      panelClass="pop__panel--vol"
      active={state.muted}
      hover
    >
      {() => (
        <div className="volpop">
          <span className="muted volpop__value">{Math.round(level * 100)}%</span>

          <VolumeSlider value={level} onChange={setVolume} />

          <button
            className={`togglebtn ${state.muted ? 'togglebtn--on' : ''}`}
            title={state.muted ? 'Включить звук' : 'Выключить звук'}
            onClick={() => window.shell.command({ type: 'toggleMute' })}
          >
            <Volume size={15} />
          </button>
        </div>
      )}
    </Popover>
  )
}
