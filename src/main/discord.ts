import DiscordRPC from 'discord-rpc'
import { getPlayer, onPlayerChanged } from './player/engine'
import { getSettings } from './state/settings'
import type { PlayerState } from '@shared/player'
import { currentTrack } from '@shared/player'
import { SERVICE_META } from '@shared/domain'
import { artistLine } from '@shared/domain'

/**
 * Discord renders `small_image` either from an asset uploaded to the
 * application or from a plain https URL. Uploading assets would mean touching
 * the Developer Portal, so the service marks are linked instead — the same way
 * the cover art already is. Yandex.Music serves no public PNG of its own
 * (music.yandex.ru answers 403 to icon requests), so both marks come from one
 * source that does, which also keeps the pair visually consistent.
 */
const SERVICE_ICON: Record<string, string> = {
  vk: 'https://www.google.com/s2/favicons?domain=vk.com&sz=128',
  yandex: 'https://www.google.com/s2/favicons?domain=music.yandex.ru&sz=128'
}

const clientId = '1549024887643840612'

/**
 * Discord считает обновления статуса и глушит того, кто частит: около пяти
 * штук за двадцать секунд. Перебор десятка треков подряд как раз в это
 * упирался — Discord переставал принимать и статус застывал на давно
 * сыгранном. Поэтому отправка идёт не чаще, чем раз в эти секунды, а то, что
 * не успело уйти, отправляется следом одним последним состоянием.
 */
const MIN_GAP_MS = 3000

/** Ниже этого расхождения часы Discord и трек считаются согласованными. */
const DRIFT_TOLERANCE_MS = 1200

/** Через сколько пробовать снова, если Discord не отвечает. */
const RECONNECT_BASE_MS = 5000
const RECONNECT_MAX_MS = 60_000

let rpc: DiscordRPC.Client | null = null
let connected = false
let attempt = 0
let reconnectTimer: NodeJS.Timeout | null = null

/** Что уже отправлено, чтобы не отправлять то же самое. */
let lastTrackId: string | undefined
let lastPlaying: boolean | undefined
/** Момент по стенным часам, в который трек был бы на нуле. */
let lastStart = 0
let lastSentAt = 0
let pendingTimer: NodeJS.Timeout | null = null

/** Счётчики для `npm run perf`: видно, что ограничитель действительно держит. */
let sentCount = 0
let heldCount = 0

export function discordStats(): {
  sent: number
  held: number
  connected: boolean
  /** Трек, который сейчас висит в статусе, — по нему видно, отстал ли он. */
  showing: string | null
} {
  return { sent: sentCount, held: heldCount, connected, showing: lastTrackId ?? null }
}

export function initDiscordRPC(): void {
  DiscordRPC.register(clientId)
  connect()
  onPlayerChanged(consider)
}

/**
 * Подключиться и не сдаваться.
 *
 * Раньше связь устанавливалась ровно один раз: если Discord в этот момент был
 * закрыт — а его часто запускают после — статуса не появлялось до перезапуска
 * плеера. Обрыв связи не отслеживался вовсе, и `connected` навсегда оставался
 * поднятым, так что обновления уходили в никуда.
 */
function connect(): void {
  const client = new DiscordRPC.Client({ transport: 'ipc' })
  rpc = client

  client.on('ready', () => {
    connected = true
    attempt = 0
    // После переподключения Discord ничего о нас не помнит.
    forget()
    consider(getPlayer())
  })

  client.on('disconnected', () => {
    connected = false
    scheduleReconnect()
  })

  client.login({ clientId }).catch(() => {
    connected = false
    scheduleReconnect()
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
  attempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    // Старого клиента надо закрыть, иначе каналы копятся.
    void rpc?.destroy().catch(() => undefined)
    rpc = null
    connect()
  }, delay)
}

function forget(): void {
  lastTrackId = undefined
  lastPlaying = undefined
  lastStart = 0
  lastSentAt = 0
}

/**
 * Стоит ли вообще что-то отправлять. Позиция тикает четыре раза в секунду, но
 * Discord ведёт свои часы сам: ему важно не «сколько сейчас», а от какого
 * момента считать. Поэтому отправка — на смену трека, на паузу и тогда, когда
 * этот момент разъехался: так ползунок догоняет перемотку.
 */
function consider(state: PlayerState): void {
  if (!connected) return

  const track = currentTrack(state)
  const start = Date.now() - state.positionMs
  const drifted = Math.abs(start - lastStart) > DRIFT_TOLERANCE_MS
  if (track?.id === lastTrackId && state.playing === lastPlaying && !drifted) return

  // Пока идёт загрузка, позиция уже переставлена, а звук ещё не пошёл —
  // отправленные сейчас часы разъехались бы сразу после отправки.
  if (state.loading) return

  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastSentAt))
  if (wait === 0) {
    send(state)
    return
  }
  // Отложенная отправка уже стоит в очереди — второй раз её заводить незачем:
  // сработав, она возьмёт то состояние, которое будет к тому моменту.
  if (pendingTimer) return
  // Состояние берётся в момент отправки: за эти секунды трек мог смениться
  // ещё дважды, и Discord должен узнать последнее, а не промежуточное.
  heldCount += 1
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    send(getPlayer())
  }, wait)
}

function send(state: PlayerState): void {
  if (!rpc || !connected) return

  const track = currentTrack(state)
  sentCount += 1
  lastSentAt = Date.now()
  lastTrackId = track?.id
  lastPlaying = state.playing

  if (!state.playing || !track) {
    lastStart = 0
    void rpc.clearActivity().catch(() => undefined)
    return
  }

  const start = Date.now() - state.positionMs
  lastStart = start

  // Длительность берётся у декодера, а не у каталога: у VK каталожная цифра
  // регулярно расходится с настоящей, и тогда ползунок Discord отмеряет
  // неправильную дорожку — трек кончается, а полоска ещё ползёт.
  const durationMs = state.durationMs || track.durationMs

  const serviceName = SERVICE_META[track.service]?.label || track.service

  // Without artwork the card would be blank: 'default' is an asset key, and
  // this application has none uploaded. The service mark stands in instead.
  let largeImageKey = SERVICE_ICON[track.service] ?? 'default'
  if (track.coverUrl) {
    largeImageKey = track.coverUrl
    if (largeImageKey.includes('%%')) largeImageKey = largeImageKey.replace('%%', '400x400')
  }

  // The button only makes sense while this machine is actually publishing;
  // otherwise it would invite people to a session that does not exist.
  const settings = getSettings()
  const buttons =
    settings.listenTogether && settings.togetherCode
      ? [
          {
            label: 'Слушать вместе',
            url: `${settings.joinPageUrl}?join=${encodeURIComponent(settings.togetherCode)}`
          }
        ]
      : []

  // Через сырой запрос, потому что обёртка discord-rpc не умеет выставлять
  // тип активности 2 (Listening) — а именно он рисует полосу воспроизведения.
  void (rpc as unknown as { request: (name: string, args: unknown) => Promise<unknown> })
    .request('SET_ACTIVITY', {
      pid: process.pid,
      activity: {
        type: 2,
        details: track.title,
        state: artistLine(track),
        timestamps: {
          start: Math.round(start),
          // Без длительности Discord показывает просто «идёт время»; с ней —
          // полосу, и она обязана кончиться вместе с треком.
          ...(durationMs > 0 ? { end: Math.round(start + durationMs) } : {})
        },
        assets: {
          large_image: largeImageKey,
          large_text: track.album || track.title,
          small_image: SERVICE_ICON[track.service] ?? 'default',
          small_text: serviceName
        },
        // Rich Presence allows two buttons, and each is a plain link — Discord
        // has no way to hand a click back to the app. The page behind this one
        // is what decides between opening Duet and offering the download.
        ...(buttons.length > 0 ? { buttons } : {}),
        instance: false
      }
    })
    .catch(() => {
      // Discord мог закрыться между проверкой и отправкой.
      connected = false
      scheduleReconnect()
    })
}
