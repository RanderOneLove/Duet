import { useState } from 'react'
import type { Settings } from '@shared/types'
import { artistLine } from '@shared/domain'
import { currentTrack, type PlayerState } from '@shared/player'
import { formatTime, ratio } from '../../shared/format'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { Cover } from './Cover'
import { SeekBar } from './SeekBar'

interface Props {
  state: PlayerState
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}

/**
 * «Слушать вместе» по вайрфрейму 1l.
 *
 * Показывает не настройку, а положение дел: что сейчас играет, ведёте вы или
 * идёте следом, и сколько человек слушает. Число слушателей настоящее — его
 * возвращает ретранслятор в ответ на каждую публикацию; раньше мы этот ответ
 * выбрасывали, и ведущий не знал, подключился ли к нему вообще кто-нибудь.
 */
export function TogetherCard({ state, settings, onChange }: Props): JSX.Element {
  const position = useSmoothPosition(state)
  const track = currentTrack(state)
  const [copied, setCopied] = useState(false)
  const [jamCopied, setJamCopied] = useState(false)

  const following = state.following !== null
  const link =
    settings.togetherCode && settings.listenTogether
      ? `${settings.joinPageUrl}?join=${encodeURIComponent(settings.togetherCode)}`
      : null
  /*
   * Ссылка участника — та же, что и у слушателя, плюс пропуск. Пропуск и есть
   * вся разница в правах, поэтому такую ссылку раздают выборочно, а не
   * выкладывают: по ней добавляют треки и переключают.
   */
  const jamLink = link && settings.jamPass ? `${link}&jam=${encodeURIComponent(settings.jamPass)}` : null

  return (
    <div className="together">
      <div className="together__now">
        <Cover url={track?.coverUrl} seed={track?.title ?? ''} className="together__art" />
        <div className="together__meta">
          <div className="truncate together__title">
            {track ? `${track.title} · ${artistLine(track)}` : 'Ничего не играет'}
          </div>
          <div className="muted together__state">
            {formatTime(position)} / {formatTime(state.durationMs)} ·{' '}
            {following ? 'вы идёте следом' : 'вы ведёте'}
          </div>
        </div>
      </div>

      {/* Полоса здесь только показывает — перематывать чужое прослушивание
          отсюда нельзя, да и своё удобнее из плеера. */}
      <SeekBar ratio={ratio(state.durationMs, position)} seekable={false} onSeek={() => undefined} />

      <div className="together__row">
        <span className="muted together__count">
          {following
            ? state.followError
              ? state.followError
              : 'Подключено к чужой сессии'
            : state.listeners > 0
              ? `${state.listeners} ${plural(state.listeners)}`
              : 'Пока никто не подключился'}
        </span>

        {following ? (
          <button
            className="gbtn"
            onClick={() => window.shell.command({ type: 'stopFollowing' })}
          >
            Отключиться
          </button>
        ) : (
          <button
            className="pill pill--sm"
            disabled={!link}
            title={link ?? 'Включите «Разрешить слушать вместе»'}
            onClick={() => {
              if (!link) return
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              })
            }}
          >
            {copied ? 'Скопировано' : 'Скопировать ссылку'}
          </button>
        )}
      </div>

      {/* Общая сессия: вторая ссылка, с правами. */}
      <div className="together__jam">
        <div className="together__jam-head">
          <span className="together__jam-title">Общая сессия</span>
          <span className="muted together__jam-hint">
            {state.jamOpen
              ? 'Очередь, участники и ссылки — на экране Duet Jam в боковой колонке'
              : 'Открыть, чтобы гости могли добавлять треки в очередь'}
          </span>
        </div>

        {state.jamOpen ? (
          <div className="together__jam-row">
            <button
              className="pill pill--sm"
              disabled={!jamLink}
              title={jamLink ?? ''}
              onClick={() => {
                if (!jamLink) return
                void navigator.clipboard.writeText(jamLink).then(() => {
                  setJamCopied(true)
                  setTimeout(() => setJamCopied(false), 2000)
                })
              }}
            >
              {jamCopied ? 'Скопировано' : 'Ссылка участника'}
            </button>
            <button
              className="gbtn"
              title="Выдать новый пропуск: прежние ссылки перестанут работать"
              onClick={() => window.shell.command({ type: 'rotateJam' })}
            >
              Сменить ссылку
            </button>
            <button className="gbtn" onClick={() => window.shell.command({ type: 'closeJam' })}>
              Закрыть
            </button>
          </div>
        ) : (
          <div className="together__jam-row">
            <button
              className="pill pill--sm"
              disabled={!link}
              title={link ? '' : 'Сначала включите «Разрешить слушать вместе»'}
              onClick={() => window.shell.command({ type: 'openJam' })}
            >
              Открыть общую сессию
            </button>
          </div>
        )}
      </div>

      <div className="together__toggle">
        <span>Кнопка в статусе Discord</span>
        <button
          className="toggle"
          aria-pressed={settings.listenTogether}
          onClick={() => onChange({ listenTogether: !settings.listenTogether })}
        >
          <i />
        </button>
      </div>

      <p className="muted together__note">
        Через ретранслятор идёт только «какой трек и с какой секунды» — звук не
        передаётся. Трек из Яндекса не заиграет у того, у кого Яндекс не подключён.
      </p>
    </div>
  )
}

function plural(count: number): string {
  const tens = count % 100
  if (tens >= 11 && tens <= 14) return 'слушателей'
  switch (count % 10) {
    case 1:
      return 'слушатель'
    case 2:
    case 3:
    case 4:
      return 'слушателя'
    default:
      return 'слушателей'
  }
}
