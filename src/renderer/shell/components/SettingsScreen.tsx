import { useEffect, useState, type ReactNode } from 'react'
import {
  MINI_ANCHORS,
  MINI_VARIANTS,
  type DisplayInfo,
  type HotkeyStatus,
  type MiniAnchor,
  type AutoDownloadScope,
  type MiniVariant,
  type Settings
} from '@shared/types'
import { SERVICE_META, type Connection, type ServiceId } from '@shared/domain'
import type { PlayerState, RepeatMode } from '@shared/player'
import { MiniPreview } from './MiniPreview'
import { Segmented } from './Segmented'
import { DuetMark } from '../../shared/Icons'
import { ServiceLogo } from '../../shared/ServiceLogo'

interface Props {
  settings: Settings
  hotkeys: HotkeyStatus
  player: PlayerState
  connections: Connection[]
  onChange: (patch: Partial<Settings>) => void
  onConnect: (id: ServiceId) => Promise<void>
  onDisconnect: (id: ServiceId) => Promise<void>
}

type Pane = 'accounts' | 'playback' | 'downloads' | 'mini' | 'shortcuts' | 'about'

const PANES: { id: Pane; label: string }[] = [
  { id: 'accounts', label: 'Аккаунты' },
  { id: 'playback', label: 'Воспроизведение' },
  { id: 'downloads', label: 'Загрузки' },
  { id: 'mini', label: 'Мини-плеер' },
  { id: 'shortcuts', label: 'Горячие клавиши' },
  { id: 'about', label: 'О программе' }
]

const LIMITS = [1, 2, 4, 8, 16, 32]

const HOTKEYS: { key: keyof Settings; label: string }[] = [
  { key: 'hotkeyPlayPause', label: 'Воспроизведение / пауза' },
  { key: 'hotkeyNext', label: 'Следующий трек' },
  { key: 'hotkeyPrev', label: 'Предыдущий трек' },
  { key: 'hotkeyToggleMini', label: 'Показать / скрыть мини-плеер' }
]

/** Wireframe 2h: a pane list on the left, grouped setting rows on the right. */
export function SettingsScreen({
  settings,
  hotkeys,
  player,
  connections,
  onChange,
  onConnect,
  onDisconnect
}: Props): JSX.Element {
  const [pane, setPane] = useState<Pane>('accounts')

  return (
    <div className="settings">
      <div className="settings__nav">
        {PANES.map((item) => (
          <button
            key={item.id}
            className="navitem navitem--sm"
            aria-current={pane === item.id ? 'page' : undefined}
            onClick={() => setPane(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="settings__pane">
        {pane === 'accounts' && (
          <AccountsPane connections={connections} onConnect={onConnect} onDisconnect={onDisconnect} />
        )}
        {pane === 'playback' && <PlaybackPane player={player} settings={settings} onChange={onChange} />}
        {pane === 'downloads' && <DownloadsPane settings={settings} onChange={onChange} />}
        {pane === 'mini' && <MiniPane settings={settings} player={player} onChange={onChange} />}
        {pane === 'shortcuts' && <ShortcutsPane settings={settings} hotkeys={hotkeys} onChange={onChange} />}
        {pane === 'about' && <AboutPane />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function AccountsPane({
  connections,
  onConnect,
  onDisconnect
}: Pick<Props, 'connections' | 'onConnect' | 'onDisconnect'>): JSX.Element {
  const [busy, setBusy] = useState<ServiceId | null>(null)

  const run = async (id: ServiceId, action: (id: ServiceId) => Promise<void>): Promise<void> => {
    setBusy(id)
    try {
      await action(id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Group label="ПОДКЛЮЧЁННЫЕ СЕРВИСЫ" />
      {connections.map((connection) => (
        <div
          key={connection.service}
          className={`account ${connection.error ? 'account--error' : ''}`}
        >
          <span className={`account__badge account__badge--${connection.service}`}>
            <ServiceLogo service={connection.service} size={22} />
          </span>
          <div className="account__body">
            <div className="account__name">{SERVICE_META[connection.service].label}</div>
            <div className={connection.error ? 'account__status account__status--error' : 'muted'}>
              {connection.error ??
                (connection.connected
                  ? (connection.account?.displayName ?? 'Подключено')
                  : 'Не подключено')}
            </div>
          </div>
          <button
            className={connection.connected ? 'pill pill--ghost pill--sm' : 'pill pill--sm'}
            disabled={busy !== null}
            onClick={() => void run(connection.service, onConnect)}
          >
            {busy === connection.service
              ? 'Открываем вход…'
              : connection.connected
                ? 'Переподключить'
                : 'Подключить'}
          </button>
          {connection.connected && (
            <button
              className="pill pill--outline pill--sm"
              disabled={busy !== null}
              onClick={() => void run(connection.service, onDisconnect)}
            >
              Отключить
            </button>
          )}
        </div>
      ))}
      <p className="muted settings__note">
        Вход выполняется в окне самого сервиса — приложение не видит логин и пароль и хранит только
        выданную сервисом сессию.
      </p>
    </>
  )
}

function PlaybackPane({
  player,
  settings,
  onChange
}: Pick<Props, 'player' | 'settings' | 'onChange'>): JSX.Element {
  return (
    <>
      <Group label="ВОСПРОИЗВЕДЕНИЕ" />
      <Card>
        <Row label="Громкость" hint={`${Math.round(player.volume * 100)} %`}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(player.volume * 100)}
            onChange={(event) =>
              window.shell.command({ type: 'setVolume', volume: Number(event.target.value) / 100 })
            }
          />
        </Row>
        <Row label="Без звука">
          <Toggle
            value={player.muted}
            onChange={() => window.shell.command({ type: 'toggleMute' })}
          />
        </Row>
        <Row label="Перемешивание" hint="Порядок восстановится, когда выключите">
          <Toggle
            value={player.shuffle}
            onChange={() => window.shell.command({ type: 'toggleShuffle' })}
          />
        </Row>
        <Row label="Повтор" last>
          <Segmented
            value={player.repeat}
            onChange={(mode: RepeatMode) => window.shell.command({ type: 'setRepeat', mode })}
            options={[
              { id: 'off', label: 'Выкл' },
              { id: 'all', label: 'Очередь' },
              { id: 'one', label: 'Трек' }
            ]}
          />
        </Row>
      </Card>
      <Group label="ОФЛАЙН" />
      <Card>
        <Row
          label="Сначала играть скачанный файл"
          hint="Если трек есть на диске — берём его, а не поток"
          last
        >
          <Toggle value={settings.preferDownloaded} onChange={(v) => onChange({ preferDownloaded: v })} />
        </Row>
      </Card>

      <Group label="ЗАПУСК" />
      <Card>
        <Row label="Запускать вместе с Windows">
          <Toggle value={settings.autoStart} onChange={(v) => onChange({ autoStart: v })} />
        </Row>
        <Row
          label="Запускать свёрнутым в трей"
          hint={settings.autoStart ? undefined : 'Действует при включённом автозапуске'}
          last
        >
          <Toggle
            value={settings.autoStartMinimized}
            onChange={(v) => onChange({ autoStartMinimized: v })}
          />
        </Row>
      </Card>

      <p className="muted settings__note">
        Громкость сохраняется между запусками. Последний трек подгружается при старте на паузе.
      </p>
    </>
  )
}

/** Wireframe 2g's settings half: what to keep, how much, and where. */
function DownloadsPane({ settings, onChange }: Pick<Props, 'settings' | 'onChange'>): JSX.Element {
  const [folder, setFolder] = useState<string | null>(settings.downloadsPath)

  return (
    <>
      <Group label="АВТОМАТИЧЕСКИ" />
      <Card>
        <Row label="Скачивать без спроса" hint="Чтобы играло без сети">
          <Toggle value={settings.autoDownload} onChange={(v) => onChange({ autoDownload: v })} />
        </Row>
        <Row
          label="Что скачивать"
          hint={
            settings.autoDownload
              ? settings.autoDownloadScope === 'liked'
                ? 'Только треки, которым вы поставили лайк'
                : 'Всё прослушанное, включая лайки'
              : 'Действует при включённом скачивании без спроса'
          }
          last
        >
          <Segmented
            value={settings.autoDownloadScope}
            onChange={(value: AutoDownloadScope) => onChange({ autoDownloadScope: value })}
            options={[
              { id: 'played', label: 'Что слушаю' },
              { id: 'liked', label: 'Только лайки' }
            ]}
          />
        </Row>
      </Card>

      <Group label="СКОЛЬКО МЕСТА" />
      <Card>
        <Row
          label="Лимит на автоматические загрузки"
          hint={`${settings.downloadLimitGb} ГБ · при нехватке удаляются самые давние`}
          last
        >
          <Segmented
            value={String(settings.downloadLimitGb)}
            onChange={(value: string) => onChange({ downloadLimitGb: Number(value) })}
            options={LIMITS.map((gb) => ({ id: String(gb), label: `${gb} ГБ` }))}
          />
        </Row>
      </Card>

      <Group label="ГДЕ ХРАНИТЬ" />
      <Card>
        <Row label="Папка" hint={folder ?? 'Внутри данных приложения'} last>
          <div className="settings__folder">
            <button
              className="pill pill--outline pill--sm"
              onClick={() => {
                void window.shell.pickDownloadsFolder().then((picked) => {
                  if (picked) setFolder(picked)
                })
              }}
            >
              Выбрать…
            </button>
            <button
              className="pill pill--outline pill--sm"
              onClick={() => void window.shell.openDownloadsFolder()}
            >
              Открыть
            </button>
          </div>
        </Row>
      </Card>

      <p className="muted settings__note">
        Лимит распространяется только на автоматические загрузки: то, что вы скачали сами, не удаляется.
        Смена папки не переносит уже скачанные файлы — они продолжат играть там, где лежат.
      </p>
    </>
  )
}

function MiniPane({
  settings,
  player,
  onChange
}: Pick<Props, 'settings' | 'player' | 'onChange'>): JSX.Element {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])

  useEffect(() => {
    void window.shell.getDisplays().then(setDisplays)
  }, [])

  return (
    <>
      <Group label="ВНЕШНИЙ ВИД" />
      <div className="settings__variants">
        {MINI_VARIANTS.map((variant) => (
          <button
            key={variant.id}
            className="variantcard"
            aria-pressed={settings.miniVariant === variant.id}
            onClick={() => onChange({ miniVariant: variant.id as MiniVariant })}
          >
            {/* The preview renders the real variant component on live state. */}
            <div className="variantcard__stage">
              <MiniPreview variant={variant.id} player={player} />
            </div>
            <div className="variantcard__label">{variant.label}</div>
            <div className="muted variantcard__hint">{variant.hint}</div>
          </button>
        ))}
      </div>

      <Group label="ПОВЕДЕНИЕ" />
      <Card>
        <Row label="Показывать при сворачивании в трей">
          <Toggle value={settings.miniOnMinimize} onChange={(v) => onChange({ miniOnMinimize: v })} />
        </Row>
        <Row label="Раскрывать по наведению" hint="Иначе — только двойным щелчком по плееру">
          <Toggle
            value={settings.miniExpandOnHover}
            onChange={(v) => onChange({ miniExpandOnHover: v })}
          />
        </Row>
        <Row label="Перетаскивать мышью" hint="Выключено — плеер закреплён там, где стоит">
          <Toggle value={settings.miniDraggable} onChange={(v) => onChange({ miniDraggable: v })} />
        </Row>
        <Row label="Прозрачность в покое" hint={`${Math.round(settings.miniIdleOpacity * 100)} %`} last>
          <input
            type="range"
            min={20}
            max={100}
            step={2}
            value={Math.round(settings.miniIdleOpacity * 100)}
            onChange={(event) => onChange({ miniIdleOpacity: Number(event.target.value) / 100 })}
          />
        </Row>
      </Card>

      <Group label="ПОЛОЖЕНИЕ" />
      <Card>
        <Row label="Место на экране">
          <select
            className="select"
            value={settings.miniAnchor}
            onChange={(event) => onChange({ miniAnchor: event.target.value as MiniAnchor })}
          >
            {MINI_ANCHORS.map((anchor) => (
              <option key={anchor.id} value={anchor.id}>
                {anchor.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Отступ от края" hint={`${settings.miniMargin} px`} last={displays.length <= 1}>
          <input
            type="range"
            min={0}
            max={120}
            step={4}
            value={settings.miniMargin}
            onChange={(event) => onChange({ miniMargin: Number(event.target.value) })}
          />
        </Row>
        {displays.length > 1 && (
          <Row label="Экран" last>
            <select
              className="select"
              value={settings.miniDisplayId ?? ''}
              onChange={(event) =>
                onChange({ miniDisplayId: event.target.value ? Number(event.target.value) : null })
              }
            >
              <option value="">Основной</option>
              {displays.map((display) => (
                <option key={display.id} value={display.id}>
                  {display.label} — {display.bounds.width}×{display.bounds.height}
                  {display.isPrimary ? ' (основной)' : ''}
                </option>
              ))}
            </select>
          </Row>
        )}
      </Card>
      <p className="muted settings__note">
        Мини-плеер можно перетащить мышью — положение сохранится как «своё место».
      </p>
    </>
  )
}

function ShortcutsPane({
  settings,
  hotkeys,
  onChange
}: Pick<Props, 'settings' | 'hotkeys' | 'onChange'>): JSX.Element {
  return (
    <>
      <Group label="ГЛОБАЛЬНЫЕ СОЧЕТАНИЯ" />
      <Card>
        {HOTKEYS.map((item, index) => (
          <Row
            key={item.key}
            label={item.label}
            hint={hotkeys[item.key] === false ? 'занята другой программой' : undefined}
            warn={hotkeys[item.key] === false}
            last={index === HOTKEYS.length - 1}
          >
            <input
              className="input input--accel"
              value={String(settings[item.key] ?? '')}
              spellCheck={false}
              onChange={(event) => onChange({ [item.key]: event.target.value } as Partial<Settings>)}
            />
          </Row>
        ))}
      </Card>
      <p className="muted settings__note">
        Работают, даже когда приложение не в фокусе. Занятую другой программой комбинацию приложение
        не перехватывает.
      </p>
    </>
  )
}

function AboutPane(): JSX.Element {
  const [info, setInfo] = useState<{ name: string; version: string } | null>(null)

  useEffect(() => {
    void window.shell.getAppInfo().then(setInfo)
  }, [])

  return (
    <>
      <div className="about">
        <DuetMark size={64} />
        <div className="about__name">{info?.name ?? 'Duet'}</div>
        <div className="muted">Версия {info?.version ?? '—'}</div>
      </div>
      <p className="muted settings__note">
        Duet сводит VK Музыку и Яндекс.Музыку в один плеер. Вход выполняется на сайтах самих сервисов,
        каталог и ссылки на треки приложение запрашивает от вашего имени.
      </p>
    </>
  )
}

// ---- small building blocks -------------------------------------------------

function Group({ label }: { label: string }): JSX.Element {
  return <div className="settings__group muted">{label}</div>
}

function Card({ children }: { children: ReactNode }): JSX.Element {
  return <div className="settings__card">{children}</div>
}

function Row({
  label,
  hint,
  warn,
  last,
  children
}: {
  label: string
  hint?: string
  warn?: boolean
  last?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <div className={`srow ${last ? 'srow--last' : ''}`}>
      <div className="srow__text">
        <div className="srow__label">{label}</div>
        {hint && <div className={`srow__hint ${warn ? 'srow__hint--warn' : 'muted'}`}>{hint}</div>}
      </div>
      <div className="srow__control">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }): JSX.Element {
  return (
    <button className="toggle" aria-pressed={value} onClick={() => onChange(!value)}>
      <i />
    </button>
  )
}
