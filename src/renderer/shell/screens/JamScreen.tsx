import { useState } from 'react'
import type { Settings } from '@shared/types'
import type { JamQueueItem } from '@shared/jam'
import { currentTrack, type PlayerState } from '@shared/player'
import { Cover } from '../components/Cover'
import { StateBlock } from '../components/StateBlock'
import { Check, PlaylistAdd, Radio } from '../../shared/Icons'

interface Props {
  state: PlayerState
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}

/**
 * Duet Jam на отдельном экране.
 *
 * Раньше вся сессия жила двумя кнопками в настройках и безымянным значком в
 * строке трека: механика работала, но посмотреть на неё было негде — ни общей
 * очереди, ни участников, ни даже подтверждения, что твой трек дошёл. Здесь
 * всё это в одном месте, и разное для двух ролей: ведущий раздаёт ссылки и
 * видит, кто что предложил; участник видит ту же очередь и знает, как в неё
 * попасть.
 */
export function JamScreen({ state, settings, onChange }: Props): JSX.Element {
  const guest = state.jamGuest
  // Слушатель без пропуска тоже смотрит сюда: очередь он видит, а трогать её
  // не может — и панель у него не про ссылки, а про то, почему кнопки серые.
  const away = state.following !== null
  const track = currentTrack(state)

  const link =
    settings.togetherCode && settings.listenTogether
      ? `${settings.joinPageUrl}?join=${encodeURIComponent(settings.togetherCode)}`
      : null
  const jamLink =
    link && settings.jamPass ? `${link}&jam=${encodeURIComponent(settings.jamPass)}` : null

  // У ведущего очередь своя и полная; участник видит присланный срез.
  const upcoming: JamQueueItem[] = away
    ? state.jamQueue
    : state.index >= 0
      ? state.queue.slice(state.index + 1, state.index + 13).map((item) => ({
          id: item.id,
          title: item.title,
          artists: item.artists,
          coverUrl: item.coverUrl ?? null,
          ...(state.jamCredits[item.id] ? { by: state.jamCredits[item.id] } : {})
        }))
      : []

  return (
    <div className="screen jam">
      <div className="jam__hero">
        <div className="jam__badge">
          <Radio size={20} />
        </div>
        <div className="jam__heroinfo">
          <div className="jam__kicker muted">СОВМЕСТНОЕ ПРОСЛУШИВАНИЕ</div>
          <h1 className="jam__title">Duet Jam</h1>
          <div className="muted">{roleLine(state)}</div>
        </div>
      </div>

      {state.followError && <div className="jam__flash">{state.followError}</div>}

      {away ? (
        <GuestPanel state={state} settings={settings} onChange={onChange} />
      ) : (
        <HostPanel state={state} settings={settings} onChange={onChange} link={link} jamLink={jamLink} />
      )}

      <h2 className="jam__section">Общая очередь</h2>
      {track && (
        <div className="jam__now">
          <Cover url={track.coverUrl} seed={track.title} className="jam__nowart" />
          <div className="jam__nowmeta">
            <div className="truncate jam__nowtitle">{track.title}</div>
            <div className="truncate muted">{track.artists.join(', ') || '—'}</div>
          </div>
          <span className="jam__nowtag">Играет</span>
        </div>
      )}

      {upcoming.length > 0 ? (
        <ol className="jam__queue">
          {upcoming.map((item, index) => (
            <li key={`${item.id}-${index}`} className="jam__item">
              <span className="jam__num muted">{index + 1}</span>
              <Cover url={item.coverUrl ?? undefined} seed={item.title} className="jam__art" />
              <div className="jam__meta">
                <div className="truncate jam__itemtitle">{item.title}</div>
                <div className="truncate muted">{item.artists.join(', ') || '—'}</div>
              </div>
              <span className="jam__by muted">{item.by ? `предложил ${item.by}` : 'от ведущего'}</span>
            </li>
          ))}
        </ol>
      ) : (
        <StateBlock
          kind="empty"
          title={следующихНет(state)}
          hint={
            guest
              ? 'Найдите трек в поиске или в своей фонотеке и нажмите «В очередь» — он появится здесь у всех.'
              : 'Треки, которые предложат участники, встанут сюда сразу после играющего.'
          }
        />
      )}
    </div>
  )
}

/** Одна строка о том, кто вы в этой сессии и сколько вас. */
function roleLine(state: PlayerState): string {
  if (state.jamGuest) return 'Вы участник: можно добавлять треки и переключать'
  if (state.following) return 'Вы слушаете чужую сессию — добавлять может только участник'
  if (!state.jamOpen) return 'Сессия не открыта'
  return state.listeners > 0
    ? `Вы ведущий · ${state.listeners} ${plural(state.listeners)}`
    : 'Вы ведущий · пока никто не подключился'
}

function следующихНет(state: PlayerState): string {
  return state.following ? 'Дальше пока ничего' : 'Очередь пуста'
}

interface HostProps extends Props {
  link: string | null
  jamLink: string | null
}

function HostPanel({ state, settings, onChange, link, jamLink }: HostProps): JSX.Element {
  return (
    <div className="jam__panel">
      {!settings.listenTogether ? (
        <>
          <p className="jam__lead">
            Общая сессия работает поверх «Слушать вместе»: наружу уходит только название трека и
            секунда, с которой он идёт. Звук остаётся здесь — каждый слышит из своего аккаунта.
          </p>
          <div className="jam__actions">
            <button className="pill" onClick={() => onChange({ listenTogether: true })}>
              Включить «Слушать вместе»
            </button>
          </div>
        </>
      ) : !state.jamOpen ? (
        <>
          <p className="jam__lead">
            Откройте сессию — и появится вторая ссылка, с правами. Тот, кто зашёл по ней, может
            добавлять треки в вашу очередь и переключать. Обычная ссылка так и остаётся только
            послушать.
          </p>
          <div className="jam__actions">
            <button className="pill" onClick={() => window.shell.command({ type: 'openJam' })}>
              Открыть общую сессию
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="jam__lead">
            Раздайте нужную ссылку. Ссылку участника — только тем, кому доверяете очередь: её можно
            в любой момент сменить, и прежние перестанут работать, а слушатели останутся.
          </p>
          <div className="jam__links">
            <LinkRow label="Послушать" hint="Только слушать, без прав" url={link} />
            <LinkRow label="Участвовать" hint="Добавлять треки и переключать" url={jamLink} strong />
          </div>
          <div className="jam__actions">
            <button
              className="pill pill--outline"
              title="Выдать новый пропуск: прежние ссылки участника перестанут работать"
              onClick={() => window.shell.command({ type: 'rotateJam' })}
            >
              Сменить ссылку участника
            </button>
            <button
              className="pill pill--ghost"
              onClick={() => window.shell.command({ type: 'closeJam' })}
            >
              Закрыть сессию
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function GuestPanel({ state, settings, onChange }: Props): JSX.Element {
  // Пропуск — вся разница между участником и слушателем, и говорить об этом
  // надо прямо: иначе неработающая кнопка «дальше» выглядит поломкой.
  if (!state.jamGuest) {
    return (
      <div className="jam__panel">
        <p className="jam__lead">
          Вы слушаете чужую сессию по обычной ссылке: очередь видно, но переключает и добавляет
          ведущий. Чтобы участвовать, попросите у него ссылку участника.
        </p>
        <div className="jam__actions">
          <button
            className="pill pill--ghost"
            onClick={() => window.shell.command({ type: 'stopFollowing' })}
          >
            Выйти из сессии
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="jam__panel">
      <p className="jam__lead">
        <PlaylistAdd size={14} /> Откройте поиск или свою фонотеку и нажмите на треке «В очередь» —
        он уйдёт ведущему и появится в списке ниже у всех участников. Кнопки «дальше» и «назад» в
        плите теперь тоже ваши: они переключают у ведущего.
      </p>
      <div className="jam__name">
        <label className="jam__namelabel" htmlFor="jam-name">
          Подписывать треки именем
        </label>
        <input
          id="jam-name"
          className="input"
          value={settings.jamName}
          maxLength={24}
          placeholder="как в системе"
          onChange={(event) => onChange({ jamName: event.target.value })}
        />
      </div>
      <div className="jam__actions">
        <button
          className="pill pill--ghost"
          onClick={() => window.shell.command({ type: 'stopFollowing' })}
        >
          Выйти из сессии
        </button>
      </div>
    </div>
  )
}

function LinkRow({
  label,
  hint,
  url,
  strong
}: {
  label: string
  hint: string
  url: string | null
  strong?: boolean
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className={`jam__link ${strong ? 'jam__link--strong' : ''}`}>
      <div className="jam__linkinfo">
        <div className="jam__linklabel">{label}</div>
        <div className="muted jam__linkhint">{hint}</div>
      </div>
      <button
        className={strong ? 'pill pill--sm' : 'pill pill--outline pill--sm'}
        disabled={!url}
        title={url ?? 'Ссылки пока нет'}
        onClick={() => {
          if (!url) return
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }}
      >
        {copied ? (
          <>
            <Check size={13} /> Скопировано
          </>
        ) : (
          'Скопировать'
        )}
      </button>
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
