import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion'
import type { ServiceId } from '@shared/domain'
import type { Settings } from '@shared/types'
import {
  FOLLOW_RECONNECTING,
  HOST_ID,
  type JamEvent,
  type JamPerson,
  type JamQueueItem
} from '@shared/jam'
import { currentTrack, type PlayerState } from '@shared/player'
import { formatTime, ratio } from '../../shared/format'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { ServiceLogo } from '../../shared/ServiceLogo'
import { Check, Close, Next, PlaylistAdd, Prev, Search, Volume } from '../../shared/Icons'
import { Cover } from '../components/Cover'

interface Props {
  state: PlayerState
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  /** «Предложить трек» ведёт в поиск — там у строк кнопка «В очередь». */
  onFind: (query: string) => void
}

type Role = 'host' | 'guest' | 'listener'

/*
 * Движение экрана — по навыку animate: появление ease-out, уход ease-in и
 * на четверть короче появления, перестановки — пружиной, которую можно
 * перебить на полпути. Всё это гасит MotionConfig в корне окна, когда
 * движение выключено.
 */
const EASE_OUT = [0.23, 1, 0.32, 1] as const
const EASE_IN = [0.32, 0, 0.67, 0] as const
const ENTER = { duration: 0.22, ease: EASE_OUT }
const EXIT = { duration: 0.16, ease: EASE_IN }
const SPRING = { type: 'spring', stiffness: 520, damping: 42 } as const

/**
 * Duet Jam — общая комната (макет 5a).
 *
 * Наверху сцена: что играет у всех, кто в комнате и как идёт синхронизация.
 * Слева — панель своей роли и лента «Что происходит», справа — общая очередь,
 * в которую можно сразу предложить трек. Ролей три, и экран у каждой свой:
 * ведущий раздаёт ссылки и права, участник предлагает и (если разрешено)
 * переключает и двигает, слушатель только смотрит.
 */
export function JamScreen({ state, settings, onChange, onFind }: Props): JSX.Element {
  const role: Role = state.jamGuest ? 'guest' : state.following ? 'listener' : 'host'
  const live = role !== 'host' || state.jamOpen
  const editable = role === 'host' ? state.jamOpen : role === 'guest' && state.jamPerms.edit
  const trouble =
    (role !== 'host' && state.followError === FOLLOW_RECONNECTING) || (role === 'host' && state.relayDown)
  // Прочие сообщения — ответы на свои действия: «просьба не дошла» и подобное.
  const notice = state.followError && state.followError !== FOLLOW_RECONNECTING ? state.followError : null

  return (
    <div className="screen jamroom">
      <JamStage state={state} role={role} live={live} />

      <div className="jamroom__grid">
        {/* Плашка обрыва лежит поверх сетки, а не в потоке: появившись, она не
            должна сдвигать очередь у того, кто как раз тянет строку. */}
        <AnimatePresence>
          {trouble && (
            <motion.div
              className="jamroom__flash"
              role="status"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0, transition: ENTER }}
              exit={{ opacity: 0, y: -6, transition: EXIT }}
            >
              <span className="jamroom__spin" aria-hidden={true} />
              Связь с ретранслятором прервалась — восстанавливаем поток. Сессия не закончится, Duet
              сдастся только через две минуты.
            </motion.div>
          )}
        </AnimatePresence>
        <div className="jamroom__side">
          <RolePanel state={state} settings={settings} role={role} notice={notice} onChange={onChange} />
          <Feed events={state.jamEvents} role={role} selfId={state.jamSelfId} live={live} />
        </div>
        <QueuePanel state={state} role={role} live={live} editable={editable} onFind={onFind} />
      </div>
    </div>
  )
}

/* ===========================================================================
   Сцена
=========================================================================== */

function JamStage({ state, role, live }: { state: PlayerState; role: Role; live: boolean }): JSX.Element {
  const track = currentTrack(state)
  const position = useSmoothPosition(state)
  const people = roomPeople(state, role)
  const guests = people.filter((person) => person.role === 'guest').length
  const silent = live ? anonymousListeners(state, role) : 0
  const total = people.length + silent

  const canSkip = role === 'host' ? !!track : role === 'guest' && state.jamPerms.skip
  const by =
    role === 'host'
      ? track && state.jamCredits[track.id]
        ? `предложил(а) ${state.jamCredits[track.id]}`
        : 'от вас'
      : state.jamNowBy
        ? `предложил(а) ${state.jamNowBy}`
        : 'от ведущего'

  return (
    <section className="jamstage on-hero">
      {track?.coverUrl && (
        <div className="jamstage__glow" style={{ backgroundImage: `url("${track.coverUrl}")` }} />
      )}
      <div className="jamstage__veil" />

      <div className="jamstage__grid">
        <div className="jamstage__head">
          <div className="jamstage__titles">
            <div className="jamstage__kicker">
              {live && (
                <span className="jamstage__live">
                  <span className="jamstage__pulse" />В ЭФИРЕ
                </span>
              )}
              <span>СОВМЕСТНОЕ ПРОСЛУШИВАНИЕ</span>
            </div>
            <h1 className="jamstage__title">Duet Jam</h1>
            <div className="jamstage__role">{roleLine(state, role)}</div>
          </div>

          <div className="jamstage__people">
            <div className="jamstage__avatars">
              <AnimatePresence initial={false}>
                {people.map((person) => (
                  <motion.span
                    key={person.id}
                    layout
                    className="jamavatar"
                    title={person.role === 'host' ? `${person.label} · ведущий` : person.label}
                    style={{ background: avatarColor(colorKey(person)) }}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1, transition: SPRING }}
                    exit={{ opacity: 0, scale: 0.6, transition: EXIT }}
                  >
                    {initial(person.label)}
                  </motion.span>
                ))}
                {silent > 0 && (
                  <motion.span
                    key="silent"
                    layout
                    className="jamavatar jamavatar--more"
                    title="Слушают по обычной ссылке"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1, transition: SPRING }}
                    exit={{ opacity: 0, scale: 0.6, transition: EXIT }}
                  >
                    +{silent}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <div className="jamstage__peopletext">
              <div className="jamstage__count">{peopleLine(total, guests, silent, role)}</div>
              <div className="jamstage__note">Звук не передаётся — каждый слушает из своего аккаунта</div>
            </div>
          </div>
        </div>

        <div className="jamnow">
          <div className="jamnow__art">
            {/* Обложки сменяются наплывом: старая тает, новая проступает поверх. */}
            <AnimatePresence initial={false}>
              <motion.div
                key={track?.id ?? 'none'}
                className="jamnow__artlayer"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1, transition: { duration: 0.3, ease: EASE_OUT } }}
                exit={{ opacity: 0, transition: { duration: 0.22, ease: EASE_IN } }}
              >
                <Cover url={track?.coverUrl} seed={track?.title ?? 'jam'} className="jamnow__cover" />
              </motion.div>
            </AnimatePresence>
            {track && <span className="jamnow__tag">ИГРАЕТ</span>}
          </div>

          <div className="jamnow__meta">
            <div className="jamnow__titlerow">
              <span className="truncate jamnow__title">{track?.title ?? 'Ничего не играет'}</span>
              {track && <ServiceLogo service={track.service} size={18} />}
            </div>
            <div className="truncate jamnow__sub">
              {track ? `${track.artists.join(', ') || '—'} · ${by}` : 'Включите что-нибудь — услышат все'}
            </div>
            <div className="jamnow__progress">
              <span>{formatTime(position)}</span>
              <div className="jamnow__bar">
                <i style={{ width: `${Math.round(ratio(state.durationMs, position) * 1000) / 10}%` }} />
              </div>
              <span>{formatTime(state.durationMs)}</span>
            </div>
            <div className="jamnow__sync">
              <span className={`jamnow__dot ${live ? 'jamnow__dot--on' : ''}`} />
              {syncLine(role, live)}
            </div>
            <div className="jamnow__skips">
              <button
                className="jamround"
                disabled={!canSkip}
                title={skipTitle(role, canSkip)}
                onClick={() => window.shell.command({ type: 'prev' })}
              >
                <Prev size={15} />
              </button>
              <button
                className="jamround"
                disabled={!canSkip}
                title={skipTitle(role, canSkip)}
                onClick={() => window.shell.command({ type: 'next' })}
              >
                <Next size={15} />
              </button>
              <span className="jamnow__skiphint">{skipHint(role, canSkip)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

interface ShownPerson extends JamPerson {
  /** Как показать: себя — «Вы». */
  label: string
}

/** Кто в комнате глазами смотрящего: себя он видит как «Вы». */
function roomPeople(state: PlayerState, role: Role): ShownPerson[] {
  if (role === 'host' && !state.jamOpen) return [{ id: HOST_ID, name: 'Вы', role: 'host', label: 'Вы' }]
  const people = state.jamRoom.people.map((person) => ({
    ...person,
    label:
      (role === 'host' && person.id === HOST_ID) || (role !== 'host' && person.id === state.jamSelfId)
        ? 'Вы'
        : person.name
  }))
  // Своё «я здесь» могло ещё не вернуться от ведущего — себя показываем сразу.
  if (role === 'guest' && state.jamSelfId && !people.some((person) => person.id === state.jamSelfId)) {
    people.push({ id: state.jamSelfId, name: 'Вы', role: 'guest', label: 'Вы' })
  }
  return people
}

/** Сколько слушает молча — по обычной ссылке, без имени. */
function anonymousListeners(state: PlayerState, role: Role): number {
  if (role === 'host') {
    const guests = state.jamRoom.people.filter((person) => person.role === 'guest').length
    return Math.max(0, state.listeners - guests)
  }
  return state.jamRoom.listeners
}

function peopleLine(total: number, guests: number, silent: number, role: Role): string {
  if (total <= 1) return role === 'host' ? 'Пока только вы' : 'В комнате только вы и ведущий'
  const parts: string[] = []
  if (guests > 0) parts.push(`${guests} ${plural(guests, 'участник', 'участника', 'участников')}`)
  if (silent > 0) parts.push(`${silent} ${plural(silent, 'слушатель', 'слушателя', 'слушателей')}`)
  return `${total} в комнате${parts.length ? ` · ${parts.join(', ')}` : ''}`
}

function roleLine(state: PlayerState, role: Role): string {
  if (role === 'guest') {
    const can = ['добавлять треки']
    if (state.jamPerms.skip) can.push('переключать')
    if (state.jamPerms.edit) can.push('менять очередь')
    return `Вы участник: можно ${can.join(', ')}`
  }
  if (role === 'listener') return 'Вы слушаете чужую сессию — добавлять может только участник'
  if (!state.jamOpen) return 'Сессия не открыта'
  /*
   * Сколько с вами — большее из двух чисел: подключённых к потоку (их считает
   * ретранслятор) и назвавших себя участников. Пока одно из них не успело
   * обновиться, строка не должна говорить «никого», когда в комнате уже есть
   * аватарка.
   */
  const guests = state.jamRoom.people.filter((person) => person.role === 'guest').length
  const others = Math.max(state.listeners, guests)
  return others > 0
    ? `Вы ведущий · с вами ${others} ${plural(others, 'человек', 'человека', 'человек')}`
    : 'Вы ведущий · пока никто не подключился'
}

/**
 * Строка про синхронизацию — только то, что правда. Отставание гостей никто
 * не измеряет, поэтому числа здесь нет; зато порог подстройки — настоящий,
 * тот же, что в движке.
 */
function syncLine(role: Role, live: boolean): string {
  if (role === 'host') {
    return live ? 'Вы ведёте · остальные подстраиваются под вашу секунду' : 'Комната закрыта · играет только у вас'
  }
  return 'Синхронно с ведущим · перемотка при расхождении больше 2 с'
}

function skipTitle(role: Role, can: boolean): string {
  if (!can) return role === 'host' ? 'Нечего переключать' : 'Переключает ведущий'
  return role === 'guest' ? 'Просьба уйдёт ведущему' : 'Переключить'
}

function skipHint(role: Role, can: boolean): string {
  if (role === 'host') return ''
  return can ? 'переключите у всех' : 'переключает ведущий'
}

/* ===========================================================================
   Панель роли
=========================================================================== */

function RolePanel({
  state,
  settings,
  role,
  notice,
  onChange
}: {
  state: PlayerState
  settings: Settings
  role: Role
  notice: string | null
  onChange: (patch: Partial<Settings>) => void
}): JSX.Element {
  const link =
    settings.togetherCode && settings.listenTogether
      ? `${settings.joinPageUrl}?join=${encodeURIComponent(settings.togetherCode)}`
      : null
  const jamLink =
    link && settings.jamPass ? `${link}&jam=${encodeURIComponent(settings.jamPass)}` : null
  const leave = (
    <button className="jambtn jambtn--ghost" onClick={() => window.shell.command({ type: 'stopFollowing' })}>
      Выйти из сессии
    </button>
  )

  let title: string
  let lead: string
  let body: JSX.Element | null = null
  let actions: JSX.Element

  if (role === 'host' && !settings.listenTogether) {
    title = 'Начать'
    lead =
      'Общая сессия работает поверх «Слушать вместе»: наружу уходит только название трека и секунда, с которой он идёт. Звук остаётся здесь, каждый слышит его из своего аккаунта.'
    actions = (
      <button className="jambtn jambtn--primary" onClick={() => onChange({ listenTogether: true })}>
        Включить «Слушать вместе»
      </button>
    )
  } else if (role === 'host' && !state.jamOpen) {
    title = 'Открыть комнату'
    lead =
      'Откройте сессию, и появится вторая ссылка, с правами. Тот, кто зашёл по ней, может добавлять треки в вашу очередь и переключать. Обычная ссылка по-прежнему только для прослушивания.'
    actions = (
      <button className="jambtn jambtn--primary" onClick={() => window.shell.command({ type: 'openJam' })}>
        Открыть общую сессию
      </button>
    )
  } else if (role === 'host') {
    title = 'Пригласить'
    lead = 'Ссылку участника — только тем, кому доверяете очередь.'
    body = (
      <>
        <div className="jamlinks">
          <LinkRow
            icon={<Volume size={16} />}
            label="Послушать"
            hint={`Только слушать, без прав · ?join=${(settings.togetherCode ?? '').slice(0, 5)}`}
            url={link}
          />
          <LinkRow
            icon={<PlaylistAdd size={16} />}
            label="Участвовать"
            hint={`Добавлять треки и то, что разрешите ниже · пропуск ${(settings.jamPass ?? '').slice(0, 4)}`}
            url={jamLink}
            strong
          />
        </div>
        <div className="jamperms">
          <PermCard
            label="Участники переключают треки"
            hint="«Дальше» и «назад» в плите участника"
            value={settings.jamGuestsSkip}
            onChange={(value) => onChange({ jamGuestsSkip: value })}
          />
          <PermCard
            label="Участники меняют очередь"
            hint="Перетаскивать треки и убирать их из очереди"
            value={settings.jamGuestsEdit}
            onChange={(value) => onChange({ jamGuestsEdit: value })}
          />
        </div>
      </>
    )
    actions = (
      <>
        <button
          className="jambtn jambtn--outline"
          title="Выдать новый пропуск: прежние ссылки участника перестанут работать"
          onClick={() => window.shell.command({ type: 'rotateJam' })}
        >
          Сменить ссылку участника
        </button>
        <button className="jambtn jambtn--ghost" onClick={() => window.shell.command({ type: 'closeJam' })}>
          Закрыть сессию
        </button>
      </>
    )
  } else if (role === 'guest') {
    title = 'Как добавить трек'
    lead =
      'Найдите трек в поиске или в своей фонотеке и нажмите «В очередь». Он уйдёт ведущему и появится в списке справа у всех.' +
      (state.jamPerms.skip
        ? ' Кнопки «дальше» и «назад» в плите тоже работают: они переключают трек у ведущего.'
        : ' Переключает только ведущий, он оставил это за собой.') +
      (state.jamPerms.edit ? ' Треки в очереди можно перетаскивать и убирать.' : ' Порядок очереди меняет ведущий.')
    body = (
      <label className="jamname">
        <span>Подписывать треки именем</span>
        <input
          className="input"
          value={settings.jamName}
          maxLength={24}
          placeholder="как в системе"
          onChange={(event) => onChange({ jamName: event.target.value })}
        />
      </label>
    )
    actions = leave
  } else {
    title = 'Вы слушатель'
    lead =
      'Вы слушаете чужую сессию по обычной ссылке: очередь видно, но переключает и добавляет треки ведущий. Чтобы участвовать, попросите у него ссылку участника.'
    actions = leave
  }

  return (
    <section className="jamcard jampanel">
      <div className="jamcard__title">{title}</div>
      <p className="jampanel__lead">{lead}</p>
      {body}
      <AnimatePresence initial={false}>
        {notice && (
          <motion.div
            key={notice}
            className="jampanel__notice"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: ENTER }}
            exit={{ opacity: 0, transition: EXIT }}
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="jampanel__actions">{actions}</div>
    </section>
  )
}

function LinkRow({
  icon,
  label,
  hint,
  url,
  strong
}: {
  icon: JSX.Element
  label: string
  hint: string
  url: string | null
  strong?: boolean
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  return (
    <div className={`jamlink ${strong ? 'jamlink--strong' : ''}`}>
      <span className="jamlink__icon">{icon}</span>
      <div className="jamlink__info">
        <div className="jamlink__label">{label}</div>
        <div className="jamlink__hint">{hint}</div>
      </div>
      <button
        className={`jambtn ${strong ? 'jambtn--primary' : 'jambtn--outline'} jambtn--sm`}
        disabled={!url}
        title={url ?? 'Ссылки пока нет'}
        onClick={() => {
          if (!url) return
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true)
            if (timer.current !== null) window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setCopied(false), 2000)
          })
        }}
      >
        {/* Подпись сменяется, а не перескакивает: «Скопировано» — ответ на нажатие. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? 'done' : 'copy'}
            className="jambtn__label"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.15, ease: EASE_OUT } }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.11, ease: EASE_IN } }}
          >
            {copied ? (
              <>
                <Check size={13} /> Скопировано
              </>
            ) : (
              'Скопировать'
            )}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  )
}

function PermCard({
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
    <div className="jamperm">
      <div className="jamperm__info">
        <div className="jamperm__label">{label}</div>
        <div className="jamperm__hint">{hint}</div>
      </div>
      <button className="toggle" aria-pressed={value} aria-label={label} onClick={() => onChange(!value)}>
        <i />
      </button>
    </div>
  )
}

/* ===========================================================================
   Лента «Что происходит»
=========================================================================== */

function Feed({
  events,
  role,
  selfId,
  live
}: {
  events: JamEvent[]
  role: Role
  selfId: string | null
  live: boolean
}): JSX.Element {
  const shown = live ? events.slice(0, 4) : []
  return (
    <section className="jamcard jamfeed">
      <div className="jamfeed__head">
        <span className="jamcard__title jamcard__title--sm">Что происходит</span>
        <span className="jamfeed__all">видно всем</span>
      </div>
      {shown.length === 0 ? (
        <div className="jamfeed__empty">
          {live ? 'Пока тихо — здесь появится, кто пришёл и что предложил' : 'Откройте комнату — здесь появятся события'}
        </div>
      ) : (
        <ul className="jamfeed__list">
          {/* Новое событие въезжает сверху, старые сдвигаются — не перескакивают. */}
          <AnimatePresence initial={false}>
            {shown.map((event) => {
              const view = eventView(event, role, selfId)
              return (
                <motion.li
                  key={`${event.at}-${event.kind}-${event.who?.id ?? 'host'}`}
                  layout
                  className="jamfeed__row"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0, transition: ENTER }}
                  exit={{ opacity: 0, transition: EXIT }}
                >
                  <span className="jamavatar jamavatar--sm" style={{ background: avatarColor(view.colorKey) }}>
                    {initial(view.subject)}
                  </span>
                  <span className="truncate jamfeed__text">
                    {view.subject} {view.text}
                  </span>
                  <span className="jamfeed__at">{clock(event.at)}</span>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}

/*
 * Фраза события собирается у того, кто смотрит. Ведущий о себе — «Вы
 * добавили», участники о ведущем — «Ведущий добавил». Об участниках —
 * настоящим временем («Маша предлагает»): так фраза не зависит от рода, а
 * угадывать его по имени нельзя.
 */
const PHRASES: Record<JamEvent['kind'], [string, string, string, string]> = {
  open: ['открыли общую сессию', 'открыл общую сессию', 'открыли общую сессию', 'открывает общую сессию'],
  rotate: [
    'сменили ссылку участника — прежние больше не работают',
    'сменил ссылку участника — прежние больше не работают',
    'сменили ссылку участника',
    'меняет ссылку участника'
  ],
  join: ['в комнате', 'в комнате', 'в комнате', 'в комнате'],
  leave: ['больше не в комнате', 'больше не в комнате', 'больше не в комнате', 'больше не в комнате'],
  add: ['добавили', 'добавил', 'предлагаете', 'предлагает'],
  move: ['переставили', 'переставил', 'переставляете', 'переставляет'],
  remove: ['убрали', 'убрал', 'убираете', 'убирает'],
  skip: ['переключили трек', 'переключил трек', 'переключаете трек', 'переключает трек']
}

function eventView(
  event: JamEvent,
  role: Role,
  selfId: string | null
): { subject: string; text: string; colorKey: string } {
  let form: 0 | 1 | 2 | 3
  let subject: string
  if (event.who === null) {
    form = role === 'host' ? 0 : 1
    subject = role === 'host' ? 'Вы' : 'Ведущий'
  } else if (event.who.id && event.who.id === selfId) {
    form = 2
    subject = 'Вы'
  } else {
    form = 3
    subject = event.who.name
  }
  const verb = PHRASES[event.kind][form]
  const text = event.title ? `${verb} «${event.title}»` : verb
  return { subject, text, colorKey: event.who ? event.who.name : HOST_ID }
}

/* ===========================================================================
   Общая очередь
=========================================================================== */

interface Row extends JamQueueItem {
  /** Ключ строки: один трек может стоять в очереди дважды. */
  key: string
  service: ServiceId
}

function QueuePanel({
  state,
  role,
  live,
  editable,
  onFind
}: {
  state: PlayerState
  role: Role
  live: boolean
  editable: boolean
  onFind: (query: string) => void
}): JSX.Element {
  const upcoming: JamQueueItem[] =
    role === 'host'
      ? state.index >= 0
        ? state.queue.slice(state.index + 1, state.index + 13).map((item) => ({
            id: item.id,
            title: item.title,
            artists: item.artists,
            coverUrl: item.coverUrl ?? null,
            ...(state.jamCredits[item.id] ? { by: state.jamCredits[item.id] } : {})
          }))
        : []
      : state.jamQueue

  const rows: Row[] = useMemo(() => {
    const seen = new Map<string, number>()
    return upcoming.map((item) => {
      const n = (seen.get(item.id) ?? 0) + 1
      seen.set(item.id, n)
      return { ...item, key: `${item.id}#${n}`, service: serviceOf(item.id) }
    })
    // Очередь пересобирается на каждой отрисовке; меняется она, когда меняется состав.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming.map((item) => `${item.id}~${item.by ?? ''}`).join('|')])

  const total = role === 'host' ? Math.max(0, state.queue.length - state.index - 1) : rows.length
  const count =
    role === 'host'
      ? total > rows.length
        ? `${rows.length} ближайших из ${total}`
        : `${total}`
      : `${rows.length} ближайших`
  const canAdd = live && role !== 'listener'

  return (
    <section className="jamcard jamqueue">
      <div className="jamqueue__head">
        <h2 className="jamqueue__title">Общая очередь</h2>
        {live && <span className="jamqueue__count">{count}</span>}
        <div className="jamqueue__spacer" />
        {live && (
          <span className="jamqueue__hint">
            {editable ? 'перетащите · Alt + ↑↓ · Delete' : 'порядок меняет ведущий'}
          </span>
        )}
      </div>

      {canAdd && <SuggestBar onFind={onFind} />}

      {live && rows.length > 0 ? (
        <QueueList rows={rows} editable={editable} hostView={role === 'host'} />
      ) : (
        <div className="jamqueue__empty">
          <span className="jamqueue__emptyicon">
            <PlaylistAdd size={20} />
          </span>
          <div className="jamqueue__emptytitle">
            {!live ? 'Сессия не открыта' : role === 'host' ? 'Очередь пуста' : 'Дальше пока ничего'}
          </div>
          <div className="jamqueue__emptyhint">
            {role === 'guest'
              ? 'Найдите трек в поиске или в своей фонотеке и нажмите «В очередь» — он появится здесь у всех.'
              : 'Треки, которые предложат участники, встанут сюда сразу после играющего.'}
          </div>
        </div>
      )}
    </section>
  )
}

/** «Предложить трек»: строка поиска, которая ведёт в общий поиск по обоим сервисам. */
function SuggestBar({ onFind }: { onFind: (query: string) => void }): JSX.Element {
  const [query, setQuery] = useState('')
  return (
    <form
      className="jamsuggest"
      onSubmit={(event) => {
        event.preventDefault()
        onFind(query.trim())
      }}
    >
      <Search size={15} />
      <input
        className="jamsuggest__input"
        value={query}
        placeholder="Предложить трек — найти в VK и Яндексе"
        onChange={(event) => setQuery(event.target.value)}
      />
      <button type="submit" className="jamsuggest__btn">
        <PlaylistAdd size={13} /> В очередь
      </button>
    </form>
  )
}

/**
 * Список очереди на Reorder из Framer Motion — по навыку animate для
 * перетаскивания: строки разъезжаются прямо под курсором, а не после того,
 * как его отпустили. Пока тянут, порядок живёт здесь; отпустили — уходит
 * команда, и следующий порядок приходит уже от ведущего.
 */
function QueueList({ rows, editable, hostView }: { rows: Row[]; editable: boolean; hostView: boolean }): JSX.Element {
  const [order, setOrder] = useState<string[]>(() => rows.map((row) => row.key))
  const dragging = useRef(false)
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])

  // Пришёл новый порядок — от ведущего или из своей же просьбы. Пока тянут,
  // не перебиваем: строка не должна выскользнуть из-под курсора.
  useEffect(() => {
    if (!dragging.current) setOrder(rows.map((row) => row.key))
  }, [rows])

  const move = (key: string, to: number): void => {
    const row = byKey.get(key)
    if (row) window.shell.command({ type: 'jamMove', id: row.id, to })
  }
  const remove = (key: string): void => {
    const row = byKey.get(key)
    if (row) window.shell.command({ type: 'jamRemove', id: row.id })
  }

  const visible = order.filter((key) => byKey.has(key))

  return (
    <Reorder.Group axis="y" values={visible} onReorder={setOrder} className="jamlist" as="ol">
      <AnimatePresence initial={false}>
        {visible.map((key, index) => (
          <QueueRow
            key={key}
            row={byKey.get(key)!}
            index={index}
            last={visible.length - 1}
            editable={editable}
            hostView={hostView}
            onDragStart={() => {
              dragging.current = true
            }}
            onDragEnd={() => {
              dragging.current = false
              const to = order.indexOf(key)
              const from = rows.findIndex((row) => row.key === key)
              if (to >= 0 && to !== from) move(key, to)
            }}
            onMove={(to) => move(key, to)}
            onRemove={() => remove(key)}
          />
        ))}
      </AnimatePresence>
    </Reorder.Group>
  )
}

function QueueRow({
  row,
  index,
  last,
  editable,
  hostView,
  onDragStart,
  onDragEnd,
  onMove,
  onRemove
}: {
  row: Row
  index: number
  last: number
  editable: boolean
  hostView: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (to: number) => void
  onRemove: () => void
}): JSX.Element {
  const controls = useDragControls()
  // Пока строку тащат, у неё свой фон: иначе сквозь неё видно соседние.
  const [held, setHeld] = useState(false)

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (!editable) return
    if (event.altKey && event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      onMove(index - 1)
    } else if (event.altKey && event.key === 'ArrowDown' && index < last) {
      event.preventDefault()
      onMove(index + 1)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      onRemove()
    }
  }

  return (
    <Reorder.Item
      value={row.key}
      as="li"
      className={`jamrow ${held ? 'jamrow--held' : ''}`}
      tabIndex={editable ? 0 : undefined}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => {
        setHeld(true)
        onDragStart()
      }}
      onDragEnd={() => {
        setHeld(false)
        onDragEnd()
      }}
      onKeyDown={onKeyDown}
      data-key={row.key}
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: ENTER }}
      exit={{ opacity: 0, x: -16, transition: EXIT }}
      transition={{ layout: SPRING }}
      whileDrag={{ scale: 1.015, boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35)', zIndex: 2 }}
    >
      {editable && (
        <span
          className="jamrow__grip"
          aria-hidden={true}
          onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
            event.preventDefault()
            controls.start(event)
          }}
        >
          ⋮⋮
        </span>
      )}
      <span className="jamrow__num">{index + 1}</span>
      <Cover url={row.coverUrl ?? undefined} seed={row.title} className="jamrow__art" />
      <span className="jamrow__meta">
        <span className="truncate jamrow__title">{row.title}</span>
        <span className="truncate jamrow__artist">{row.artists.join(', ') || '—'}</span>
      </span>
      <span className="jamrow__by" title={row.by ? `Предложил(а) ${row.by}` : 'Поставил ведущий'}>
        {row.by ? (
          <span className="jamavatar jamavatar--xs" style={{ background: avatarColor(row.by) }}>
            {initial(row.by)}
          </span>
        ) : (
          <span className="jamavatar jamavatar--xs jamavatar--host">★</span>
        )}
        {row.by ?? (hostView ? 'вы' : 'ведущий')}
      </span>
      <ServiceLogo service={row.service} size={18} />
      {editable && (
        <button className="jamrow__remove" title="Убрать из общей очереди (Delete)" onClick={onRemove}>
          <Close size={12} />
        </button>
      )}
    </Reorder.Item>
  )
}

/* ===========================================================================
   Мелочи
=========================================================================== */

/** Сервис трека — из его идентификатора: «vk:…» или «yandex:…». */
function serviceOf(id: string): ServiceId {
  return id.startsWith('vk:') ? 'vk' : 'yandex'
}

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}

/** Ключ цвета: у ведущего — его роль, у участника — имя. */
function colorKey(person: JamPerson): string {
  return person.role === 'host' ? HOST_ID : person.name
}

/**
 * Цвет аватара — от имени, а не случайный: тот же человек остаётся того же
 * цвета и в комнате, и в ленте, и в очереди. Ключ — имя, а не номер
 * участника: в очереди номера нет, а цвет должен совпадать везде.
 */
function avatarColor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 360
  return `oklch(0.8 0.12 ${hash})`
}

function clock(at: number): string {
  const date = new Date(at)
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100
  if (tens >= 11 && tens <= 14) return many
  switch (count % 10) {
    case 1:
      return one
    case 2:
    case 3:
    case 4:
      return few
    default:
      return many
  }
}
