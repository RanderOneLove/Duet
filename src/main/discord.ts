import DiscordRPC from 'discord-rpc'
import { getPlayer, onPlayerChanged } from './player/engine'
import { getSettings } from './state/settings'
import type { PlayerState } from '@shared/player'
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

// Установите здесь свой Client ID приложения из Discord Developer Portal
const clientId = '1549024887643840612' // ЗАМЕНИТЕ НА ВАШ ID

let rpc: DiscordRPC.Client | null = null
let isConnected = false
let lastTrackId: string | undefined
let lastPlaying: boolean | undefined
/** The wall-clock moment the current track would have started at 0:00. */
let lastStart = 0
/** Past this much disagreement the clock Discord shows is visibly wrong. */
const DRIFT_TOLERANCE_MS = 2500

export function initDiscordRPC(): void {
  DiscordRPC.register(clientId)

  rpc = new DiscordRPC.Client({ transport: 'ipc' })

  rpc.on('ready', () => {
    isConnected = true
    console.log('[discord] RPC connected')
    updateActivity(getPlayer())
  })

  rpc.login({ clientId }).catch((err: unknown) => {
    console.error('[discord] RPC login failed:', err)
  })

  onPlayerChanged((state) => {
    if (isConnected) {
      updateActivity(state)
    }
  })
}

function updateActivity(state: PlayerState): void {
  if (!rpc || !isConnected) return

  const track = state.queue[state.index]

  // The activity is pushed on a change of track or of play state — but also
  // whenever the position stops matching the clock Discord is already running.
  // Without that, a seek or a stall left it counting from the old origin, and
  // the elapsed time drifted away from the track for good.
  const start = Date.now() - state.positionMs
  const drifted = Math.abs(start - lastStart) > DRIFT_TOLERANCE_MS
  if (track?.id === lastTrackId && state.playing === lastPlaying && !drifted) {
    return
  }

  lastTrackId = track?.id
  lastPlaying = state.playing
  lastStart = start

  if (!state.playing || !track) {
    lastStart = 0
    void rpc.clearActivity()
    return
  }

  // Рассчитываем точные таймстемпы с учетом текущей позиции трека
  const calculatedStart = new Date(start)
  const calculatedEnd = new Date(start + track.durationMs)

  const serviceName = SERVICE_META[track.service]?.label || track.service

  // Without artwork the card would be blank: 'default' is an asset key, and
  // this application has none uploaded. The service mark stands in instead.
  let largeImageKey = SERVICE_ICON[track.service] ?? 'default'
  if (track.coverUrl) {
    largeImageKey = track.coverUrl
    if (largeImageKey.includes('%%')) {
      largeImageKey = largeImageKey.replace('%%', '400x400')
    }
  }

  // An empty link means no button: one that leads nowhere is worse than none.
  const shareUrl = getSettings().listenTogetherUrl.trim()
  const buttons = shareUrl ? [{ label: 'Слушать вместе', url: shareUrl }] : []

  // Используем raw request, так как discord-rpc обертка не позволяет менять type активности на 2 (Listening)
  void (rpc as any).request('SET_ACTIVITY', {
    pid: process.pid,
    activity: {
      type: 2, // 2 = Listening
      details: track.title,
      state: artistLine(track),
      timestamps: {
        start: Math.round(calculatedStart.getTime()),
        end: Math.round(calculatedEnd.getTime())
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
  }).catch((err: unknown) => console.error('[discord] Failed to set activity:', err))
}
