import { useRef, useState } from 'react'
import type { Settings } from '@shared/types'
import type { JamQueueItem } from '@shared/jam'
import { currentTrack, type PlayerState } from '@shared/player'
import { Cover } from '../components/Cover'
import { StateBlock } from '../components/StateBlock'
import { Check, Close, PlaylistAdd, Radio } from '../../shared/Icons'

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

  /*
   * Ведущий правит свою очередь всегда. Участник — если ведущий разрешил;
   * слушатель по обычной ссылке не правит никогда: прав у него нет вовсе.
   */
  const editable = !away || (guest && state.jamPerms.edit)

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
        <JamQueueList items={upcoming} editable={editable} />
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
  if (state.jamGuest) return `Вы участник: можно ${guestCan(state).join(', ')}`
  if (state.following) return 'Вы слушаете чужую сессию — добавлять может только участник'
  if (!state.jamOpen) return 'Сессия не открыта'
  return state.listeners > 0
    ? `Вы ведущий · ${state.listeners} ${plural(state.listeners)}`
    : 'Вы ведущий · пока никто не подключился'
}

/** Что участнику можно — словами, в том порядке, в каком это нужно. */
function guestCan(state: PlayerState): string[] {
  const can = ['добавлять треки']
  if (state.jamPerms.skip) can.push('переключать')
  if (state.jamPerms.edit) can.push('менять очередь')
  return can
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
            <LinkRow
              label="Участвовать"
              hint="Добавлять треки — и то, что вы разрешите ниже"
              url={jamLink}
              strong
            />
          </div>
          {/* Добавлять участники могут всегда — ради этого сессию и открывают.
              Остальное решает ведущий, и менять это можно посреди сессии:
              участники увидят новое правило со следующим же обновлением. */}
          <div className="jam__perms">
            <PermRow
              label="Участники переключают треки"
              hint="«Дальше» и «назад» в плите участника"
              value={settings.jamGuestsSkip}
              onChange={(value) => onChange({ jamGuestsSkip: value })}
            />
            <PermRow
              label="Участники меняют очередь"
              hint="Перетаскивать треки и убирать их из очереди"
              value={settings.jamGuestsEdit}
              onChange={(value) => onChange({ jamGuestsEdit: value })}
            />
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
        он уйдёт ведущему и появится в списке ниже у всех участников.
        {state.jamPerms.skip
          ? ' Кнопки «дальше» и «назад» в плите тоже ваши: они переключают у ведущего.'
          : ' Переключает ведущий — он оставил это за собой.'}
        {state.jamPerms.edit
          ? ' Треки в очереди можно перетаскивать и убирать.'
          : ' Порядок очереди меняет ведущий.'}
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

function PermRow({
  label,
  hint,
  value,
  onChange
}: {
  label: string
  hint: string
  value: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <div className="jam__perm">
      <div className="jam__perminfo">
        <div className="jam__permlabel">{label}</div>
        <div className="muted jam__permhint">{hint}</div>
      </div>
      <button
        className="toggle"
        aria-pressed={value}
        aria-label={label}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </div>
  )
}

/**
 * Общая очередь, которую можно править руками.
 *
 * Перетаскивание — тот же приём, что в очереди полноэкранного плеера: брошенный
 * трек встаёт на место того, на который его бросили. Черта показывает, куда
 * именно: при перетаскивании вниз трек встанет после строки, вверх — перед
 * ней, и без черты это приходилось угадывать.
 *
 * Для клавиатуры — Alt со стрелками и Delete: перетаскивание мышью не
 * единственный способ, которым пользуются списками.
 */
function JamQueueList({
  items,
  editable
}: {
  items: JamQueueItem[]
  editable: boolean
}): JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  /*
   * Что тащим — ещё и здесь, а не только в состоянии. Состояние React
   * обновляется после перерисовки, а события перетаскивания ждать её не
   * обязаны: `dragover` и `drop`, пришедшие раньше, видели бы «ничего не
   * тащим» и отказывались принимать трек. Ссылка меняется сразу.
   */
  const held = useRef<number | null>(null)

  const move = (id: string, to: number): void => {
    window.shell.command({ type: 'jamMove', id, to })
  }
  const remove = (id: string): void => {
    window.shell.command({ type: 'jamRemove', id })
  }
  const reset = (): void => {
    held.current = null
    setDragging(null)
    setOver(null)
  }

  return (
    <ol className={`jam__queue ${editable ? 'jam__queue--editable' : ''}`}>
      {items.map((item, index) => {
        const target = over === index && dragging !== null && dragging !== index
        const direction = dragging !== null && dragging < index ? 'below' : 'above'
        const classes = [
          'jam__item',
          dragging === index ? 'jam__item--dragging' : '',
          target ? `jam__item--${direction}` : ''
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <li
            key={`${item.id}-${index}`}
            className={classes}
            draggable={editable}
            tabIndex={editable ? 0 : undefined}
            onDragStart={(event) => {
              held.current = index
              setDragging(index)
              event.dataTransfer.effectAllowed = 'move'
              // Без полезной нагрузки перетаскивание иногда не начинается вовсе.
              event.dataTransfer.setData('text/plain', item.id)
            }}
            onDragOver={(event) => {
              // Чужое перетаскивание — файл с рабочего стола, текст — не наше.
              if (held.current === null) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setOver(index)
            }}
            onDragLeave={() => setOver((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault()
              const start = held.current
              const from = start === null ? undefined : items[start]
              if (from && start !== index) move(from.id, index)
              reset()
            }}
            onDragEnd={reset}
            onKeyDown={(event) => {
              if (!editable) return
              if (event.altKey && event.key === 'ArrowUp' && index > 0) {
                event.preventDefault()
                move(item.id, index - 1)
              } else if (event.altKey && event.key === 'ArrowDown' && index < items.length - 1) {
                event.preventDefault()
                move(item.id, index + 1)
              } else if (event.key === 'Delete') {
                event.preventDefault()
                remove(item.id)
              }
            }}
          >
            {editable && (
              <span className="jam__grip muted" aria-hidden={true}>
                ⋮⋮
              </span>
            )}
            <span className="jam__num muted">{index + 1}</span>
            <Cover url={item.coverUrl ?? undefined} seed={item.title} className="jam__art" />
            <div className="jam__meta">
              <div className="truncate jam__itemtitle">{item.title}</div>
              <div className="truncate muted">{item.artists.join(', ') || '—'}</div>
            </div>
            <span className="jam__by muted">
              {item.by ? `предложил ${item.by}` : 'от ведущего'}
            </span>
            {editable && (
              <button
                className="jam__remove"
                title="Убрать из общей очереди (Delete)"
                aria-label={`Убрать «${item.title}» из очереди`}
                onClick={() => remove(item.id)}
              >
                <Close size={12} />
              </button>
            )}
          </li>
        )
      })}
    </ol>
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
