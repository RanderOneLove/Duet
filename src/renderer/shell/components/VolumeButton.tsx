import type { PlayerState } from '@shared/player'
import { Volume } from '../../shared/Icons'
import { Popover } from './Popover'
import { VolumeSlider } from './VolumeSlider'

interface Props {
  state: PlayerState
  align?: 'up' | 'down'
}

/**
 * Громкость, спрятанная под кнопку.
 *
 * Ползунок во всю ширину хорош, пока окно широкое; в узком он первым уезжает
 * за край, а вместе с ним съезжает весь ряд. Кнопка занимает столько же, сколько
 * любая другая, а ползунок появляется над ней — вертикальный, потому что тянуть
 * вверх в узком окне есть куда, а вбок уже нет.
 */
export function VolumeButton({ state, align = 'up' }: Props): JSX.Element {
  const level = state.muted ? 0 : state.volume

  return (
    <Popover
      icon={<Volume size={15} />}
      title={`Громкость ${Math.round(level * 100)}%`}
      align={align}
      panelClass="pop__panel--vol"
      active={state.muted}
    >
      {() => (
        <div className="volpop">
          <span className="muted volpop__value">{Math.round(level * 100)}%</span>

          <VolumeSlider
            value={level}
            onChange={(value) => window.shell.command({ type: 'setVolume', volume: value })}
          />

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
