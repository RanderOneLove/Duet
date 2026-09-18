import { useEffect, useState } from 'react'
import type { Playlist, Track } from '@shared/domain'
import type { PlayerState } from '@shared/player'
import type { Settings } from '@shared/types'
import { formatTime } from '../../shared/format'
import { Check, PlaylistAdd, Speaker, Timer } from '../../shared/Icons'
import { Popover } from './Popover'

/**
 * The three controls that sit beside the transport in both the bar and the
 * full player: where the sound goes, when it should stop, and which playlist a
 * track belongs to. Each is an icon that opens a panel, so the bar stays a bar.
 */

interface Props {
  state: PlayerState
  settings: Settings
  playlists: Playlist[]
  /** Which tracks the playlist panel would add; empty hides that control. */
  tracks: Track[]
  align?: 'up' | 'down'
}

export function PlayerExtras({ state, settings, playlists, tracks, align = 'up' }: Props): JSX.Element {
  return (
    <>
      <OutputPicker state={state} align={align} />
      <SleepPicker state={state} settings={settings} align={align} />
      {tracks.length > 0 && <PlaylistPicker tracks={tracks} playlists={playlists} align={align} />}
    </>
  )
}

export function OutputPicker({
  state,
  align,
  labelled
}: {
  state: PlayerState
  align: 'up' | 'down'
  /** В панели плеера кнопка с подписью: видно, куда идёт звук, не открывая её. */
  labelled?: boolean
}): JSX.Element {
  // Windows lists "Default" and "Communications" as copies of real devices;
  // showing them would mean the same speakers three times.
  const devices = state.outputDevices.filter(
    (device) => device.id && device.id !== 'default' && device.id !== 'communications'
  )

  const current = devices.find((device) => device.id === state.outputDeviceId)

  return (
    <Popover
      icon={<Speaker size={15} />}
      label={labelled ? current?.label ?? 'Системное' : undefined}
      title="Устройство вывода"
      align={align}
      active={!!state.outputDeviceId}
    >
      {(close) => (
        <>
          <div className="pop__title">Устройство вывода</div>
          <PopRow
            label="Системное"
            checked={state.outputDeviceId === ''}
            onClick={() => {
              window.shell.command({ type: 'setOutputDevice', deviceId: '' })
              close()
            }}
          />
          {devices.map((device) => (
            <PopRow
              key={device.id}
              label={device.label}
              checked={state.outputDeviceId === device.id}
              onClick={() => {
                window.shell.command({ type: 'setOutputDevice', deviceId: device.id })
                close()
              }}
            />
          ))}
        </>
      )}
    </Popover>
  )
}

const PRESETS = [5, 15, 30, 45, 60, 90]

export function SleepPicker({
  state,
  settings,
  align,
  labelled
}: {
  state: PlayerState
  settings: Settings
  align: 'up' | 'down'
  /** С подписью кнопка показывает остаток, а не только то, что таймер идёт. */
  labelled?: boolean
}): JSX.Element {
  const [custom, setCustom] = useState('20')
  const left = useCountdown(state.sleepEndsAt)

  const set = (minutes: number | null, close: () => void): void => {
    window.shell.command({ type: 'setSleepTimer', minutes })
    close()
  }

  return (
    <Popover
      icon={<Timer size={15} />}
      label={labelled ? (state.sleepEndsAt ? `Сон ${left}` : 'Таймер сна') : undefined}
      title={state.sleepEndsAt ? `Таймер сна: ${left}` : 'Таймер сна'}
      align={align}
      active={state.sleepEndsAt !== null}
    >
      {(close) => (
        <>
          <div className="pop__title">
            Таймер сна
            {state.sleepEndsAt && <span className="pop__badge">осталось {left}</span>}
          </div>

          {state.sleepEndsAt && (
            <PopRow label="Выключить таймер" onClick={() => set(null, close)} />
          )}

          {PRESETS.map((preset) => (
            <PopRow key={preset} label={`${preset} минут`} onClick={() => set(preset, close)} />
          ))}

          <div className="pop__custom">
            <input
              type="number"
              min={1}
              max={600}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              aria-label="Своё время в минутах"
            />
            <button
              className="pill pill--sm"
              disabled={!(Number(custom) > 0)}
              onClick={() => set(Number(custom), close)}
            >
              Пуск
            </button>
          </div>

          <button
            className="pop__check"
            aria-pressed={settings.sleepSuspendsPc}
            onClick={() => void window.shell.setSettings({ sleepSuspendsPc: !settings.sleepSuspendsPc })}
          >
            <span className={`pop__box ${settings.sleepSuspendsPc ? 'pop__box--on' : ''}`}>
              {settings.sleepSuspendsPc && <Check size={11} />}
            </span>
            <span>
              Усыпить компьютер
              <span className="muted pop__hint">Когда таймер досчитает</span>
            </span>
          </button>
        </>
      )}
    </Popover>
  )
}

export function PlaylistPicker({
  tracks,
  playlists,
  align
}: {
  tracks: Track[]
  playlists: Playlist[]
  align: 'up' | 'down'
}): JSX.Element {
  const [naming, setNaming] = useState(false)
  const [title, setTitle] = useState('')
  const local = playlists.filter((playlist) => playlist.service === null)

  const create = (close: () => void): void => {
    if (!title.trim()) return
    void window.shell.createPlaylist(title, tracks)
    setTitle('')
    setNaming(false)
    close()
  }

  return (
    <Popover icon={<PlaylistAdd size={15} />} title="В плейлист" align={align}>
      {(close) => (
        <>
          <div className="pop__title">
            {tracks.length > 1 ? `В плейлист · ${tracks.length} треков` : 'В плейлист'}
          </div>

          {local.map((playlist) => (
            <PopRow
              key={playlist.nativeId}
              label={playlist.title}
              hint={`${playlist.trackCount}`}
              onClick={() => {
                void window.shell.addToPlaylist(playlist.nativeId, tracks)
                close()
              }}
            />
          ))}

          {local.length === 0 && !naming && (
            <div className="muted pop__empty">Плейлистов пока нет</div>
          )}

          {naming ? (
            <div className="pop__custom">
              <input
                autoFocus
                placeholder="Название"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') create(close)
                  if (event.key === 'Escape') setNaming(false)
                }}
              />
              <button className="pill pill--sm" disabled={!title.trim()} onClick={() => create(close)}>
                Создать
              </button>
            </div>
          ) : (
            <PopRow label="Новый плейлист…" onClick={() => setNaming(true)} />
          )}
        </>
      )}
    </Popover>
  )
}

function PopRow({
  label,
  hint,
  checked,
  onClick
}: {
  label: string
  hint?: string
  checked?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button className="pop__row" onClick={onClick}>
      <span className="truncate">{label}</span>
      {hint && <span className="muted pop__hint">{hint}</span>}
      {checked && <Check size={12} />}
    </button>
  )
}

/** Time left as m:ss, ticking only while a timer runs. */
function useCountdown(endsAt: number | null): string {
  const [, tick] = useState(0)

  useEffect(() => {
    if (!endsAt) return
    const id = setInterval(() => tick((value) => value + 1), 1000)
    return () => clearInterval(id)
  }, [endsAt])

  return endsAt ? formatTime(Math.max(0, endsAt - Date.now())) : ''
}
