import type { WaveChoice } from './domain'

/**
 * Visual style of the always-on-top mini player. Names map to the wireframe
 * artboards: bar=3a, card=3b, pill=3c, cover=3d.
 */
export type MiniVariant = 'bar' | 'card' | 'pill' | 'cover'

export const MINI_VARIANTS: { id: MiniVariant; label: string; hint: string }[] = [
  { id: 'bar', label: 'Плашка', hint: 'Минимум места, всё на виду' },
  { id: 'card', label: 'Карточка', hint: 'Обложка крупно + что дальше' },
  { id: 'pill', label: 'Пилюля', hint: 'Свёрнута, раскрывается по наведению' },
  { id: 'cover', label: 'Обложка', hint: 'Квадрат, контролы на затемнении' }
]

/**
 * Initial window size per variant, in logical px. The renderer measures its own
 * content and reports the exact size, so these only avoid a first-paint jump.
 */
export const MINI_SIZES: Record<MiniVariant, { width: number; height: number }> = {
  bar: { width: 384, height: 116 },
  card: { width: 272, height: 430 },
  pill: { width: 230, height: 48 },
  cover: { width: 264, height: 264 }
}

/** Where the mini player parks itself on the chosen display. */
export type MiniAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'custom'

export const MINI_ANCHORS: { id: MiniAnchor; label: string }[] = [
  { id: 'top-left', label: 'Сверху слева' },
  { id: 'top-center', label: 'Сверху по центру' },
  { id: 'top-right', label: 'Сверху справа' },
  { id: 'bottom-left', label: 'Снизу слева' },
  { id: 'bottom-center', label: 'Снизу по центру' },
  { id: 'bottom-right', label: 'Снизу справа' },
  { id: 'custom', label: 'Своё место (перетащить)' }
]

export type AutoDownloadScope = 'played' | 'liked'

/**
 * Когда мини-плееру появляться. «Неактивно» — как только окно теряет фокус,
 * даже если оно осталось на экране: плеер нужен именно тогда, когда смотришь
 * в другое окно.
 */
export type MiniShowWhen = 'never' | 'minimized' | 'inactive'

export interface Settings {
  /** Player volume and mute, restored between runs. */
  volume: number
  muted: boolean
  /** Play the downloaded copy when there is one. */
  preferDownloaded: boolean
  /** Keep copies without being asked. */
  autoDownload: boolean
  /** Everything played, or only what you mark as liked. */
  autoDownloadScope: AutoDownloadScope
  /** Ceiling for automatic downloads, in GB. Manual ones are never evicted. */
  downloadLimitGb: number
  /** Where files land; null means the folder inside the app's own data. */
  downloadsPath: string | null
  /** Which service's personal radio the Home hero opens on. */
  waveService: WaveChoice
  /**
   * The last track each station handed out. Yandex's rotor replays the same
   * opening batch unless it is told where the listener got to, so without this
   * every launch of the wave began with the same song.
   */
  waveCursors: Record<string, string>
  /** Playback output; '' follows whatever Windows is using. */
  outputDeviceId: string
  /** The last few searches, newest first. */
  recentSearches: string[]
  /** Put the machine to sleep when the sleep timer runs out. */
  sleepSuspendsPc: boolean
  /**
   * Publish what is playing, so someone who follows the invite hears the same
   * thing. Off by default: this sends track names to a server, and that should
   * be a decision rather than a surprise.
   */
  listenTogether: boolean
  /** The relay that passes «which track and from what second» along. */
  relayUrl: string
  /** The page that turns an invite link into a launch of the app. */
  joinPageUrl: string
  /** This machine's invite, made once and kept so the link stays the same. */
  togetherCode: string
  /** Proves this machine is the host; goes to the relay and nowhere else. */
  togetherKey: string
  /** Collapse the sidebar to icons only. */
  sidebarCollapsed: boolean
  /** Launch with Windows. */
  autoStart: boolean
  /** When auto-started, go straight to the tray instead of opening a window. */
  autoStartMinimized: boolean
  /** Show the mini player automatically whenever the app hides to the tray. */
  miniShowWhen: MiniShowWhen
  miniVariant: MiniVariant
  miniAnchor: MiniAnchor
  /** Gap from the screen edge for non-custom anchors, in px. */
  miniMargin: number
  /** Saved coordinates for the `custom` anchor (set by dragging the window). */
  miniCustomX: number | null
  miniCustomY: number | null
  /** `Display.id` to park on; falls back to the primary display when gone. */
  miniDisplayId: number | null
  /** Opacity while the pointer is away, 0.2..1. */
  miniIdleOpacity: number
  /** Expand on hover, or only when the expand button is clicked. */
  miniExpandOnHover: boolean
  /** Let the plate be dragged around, or pin it where it stands. */
  miniDraggable: boolean
  hotkeyToggleMini: string
  hotkeyPlayPause: string
  hotkeyNext: string
  hotkeyPrev: string
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  muted: false,
  preferDownloaded: true,
  autoDownload: false,
  autoDownloadScope: 'played',
  downloadLimitGb: 4,
  downloadsPath: null,
  waveService: 'yandex',
  waveCursors: {},
  outputDeviceId: '',
  recentSearches: [],
  sleepSuspendsPc: false,
  listenTogether: false,
  relayUrl: 'https://rander.pro/duet',
  joinPageUrl: 'https://randeronelove.github.io/Duet/',
  togetherCode: '',
  togetherKey: '',
  sidebarCollapsed: false,
  autoStart: false,
  autoStartMinimized: true,
  miniShowWhen: 'minimized',
  miniVariant: 'bar',
  miniAnchor: 'bottom-right',
  miniMargin: 24,
  miniCustomX: null,
  miniCustomY: null,
  miniDisplayId: null,
  miniIdleOpacity: 0.92,
  miniExpandOnHover: true,
  miniDraggable: true,
  hotkeyToggleMini: 'CommandOrControl+Shift+M',
  hotkeyPlayPause: 'MediaPlayPause',
  hotkeyNext: 'MediaNextTrack',
  hotkeyPrev: 'MediaPreviousTrack'
}

/** A display the user can park the mini player on, as shown in settings. */
export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  isPrimary: boolean
}

/** Which registered global shortcuts actually took effect. */
export type HotkeyStatus = Record<string, boolean>
