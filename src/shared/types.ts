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

/**
 * Оформление окна. «Как в системе» разрешается уже в самих окнах — через
 * запрос к системной настройке, — а здесь хранится именно выбор человека,
 * иначе переключение системы на светлое молча переписывало бы его решение.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

/**
 * Сколько в интерфейсе движения.
 *
 * Общий уровень, а не выключатель у каждой анимации: «выключено» должно гасить
 * всё разом, не заставляя обходить четыре тумблера.
 *
 * «Как в системе» — умолчание: если в Windows выключены анимации, приложение
 * молчит вместе с ней. Остальные три — осознанное решение человека, и оно
 * систему перекрывает. Без этого выбор в настройках был бы обманом: на машине
 * с выключенными анимациями включить их было бы невозможно.
 */
export type MotionLevel = 'system' | 'off' | 'calm' | 'lively'

/** Как появляется полноэкранный плеер. */
export type PlayerAnimation = 'sheet' | 'zoom' | 'fade'

/** Живёт ли обложка в «Моей волне». */
export type WaveAnimation = 'still' | 'breathe' | 'drift'

/** Переход между экранами приложения. */
export type ScreenAnimation = 'none' | 'fade' | 'slide'

/** Что делает двойной щелчок по мини-плееру. */
export type MiniDoubleClick = 'expand' | 'openPlayer' | 'nothing'

/**
 * Насколько плотно идут строки в списках. Высота строки — 40 / 52 / 64,
 * и её знает не только вёрстка: на ней держится виртуализация списка.
 */
export type Density = 'compact' | 'normal' | 'roomy'

/** Высота строки для каждой плотности — одна на CSS и на расчёт видимых строк. */
export const ROW_HEIGHT: Record<Density, number> = {
  compact: 40,
  normal: 52,
  roomy: 64
}

/** Каким показывать главный экран. */
export type HomeLayout = 'calm' | 'cover' | 'list'

/** Каким показывать полноэкранный плеер. */
export type PlayerLayout = 'split' | 'center' | 'ambient'

/** Блоки Главной, которые можно переставлять и прятать. */
export type HomeBlockId = 'wave' | 'playlists' | 'liked' | 'downloads'

export interface HomeBlock {
  id: HomeBlockId
  shown: boolean
}

/**
 * Цвета акцента из вайрфрейма 2b. Первый — синий, как в приложении сейчас;
 * восьмым идёт свой цвет, который человек выбирает палитрой.
 */
export const ACCENTS: string[] = [
  '#0a84ff',
  '#30d158',
  '#ff375f',
  '#ff6b35',
  '#bf5af2',
  '#ffd60a',
  '#64d2ff'
]

export const DEFAULT_HOME_BLOCKS: HomeBlock[] = [
  { id: 'wave', shown: true },
  { id: 'playlists', shown: true },
  { id: 'liked', shown: true },
  { id: 'downloads', shown: false }
]

export interface Settings {
  /** Светлое или тёмное оформление, либо вслед за системой. */
  theme: ThemeChoice
  /** Общий уровень движения в интерфейсе. */
  motion: MotionLevel
  /** Цвет акцента — из палитры или свой, в виде #rrggbb. */
  accent: string
  /** Брать акцент с обложки играющего трека. */
  accentFromCover: boolean
  /** Подкрашивать фон полноэкранного плеера обложкой. */
  playerTintFromCover: boolean
  /** Высота строк в списках. */
  density: Density
  /** Каким показывать главный экран. */
  homeLayout: HomeLayout
  /** Каким показывать полноэкранный плеер. */
  playerLayout: PlayerLayout
  /** Порядок и видимость блоков Главной. */
  homeBlocks: HomeBlock[]
  /** Чем появляется полноэкранный плеер. */
  motionPlayer: PlayerAnimation
  /** Что происходит с обложкой в «Моей волне». */
  motionWave: WaveAnimation
  /** Как сменяются экраны. */
  motionScreens: ScreenAnimation
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
  /**
   * Треки VK, отмеченные «не нравится».
   *
   * У VK нет метода, которым такую отметку можно было бы передать на сервер, —
   * список живёт здесь и применяется на нашей стороне: отвергнутое не приходит
   * из волны. Хранятся номера вида `owner_id_audio_id`, новые впереди.
   */
  vkDisliked: string[]
  /** Put the machine to sleep when the sleep timer runs out. */
  sleepSuspendsPc: boolean
  /**
   * Смотреть, не вышла ли новая версия, и скачивать её заранее.
   *
   * Включено: обновление ставится при выходе из приложения, так что человек
   * закрывает одну версию, а открывает уже следующую. Выключено — приложение
   * в сеть за этим не ходит вовсе, но кнопка «Проверить» всё равно работает:
   * выключатель про то, чтобы не делали без спроса, а не про то, чтобы нельзя.
   */
  autoUpdate: boolean
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
  /** Что делает двойной щелчок по плите мини-плеера. */
  miniDoubleClick: MiniDoubleClick
  hotkeyToggleMini: string
  hotkeyPlayPause: string
  hotkeyNext: string
  hotkeyPrev: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  motion: 'system',
  accent: ACCENTS[0]!,
  accentFromCover: false,
  playerTintFromCover: true,
  density: 'normal',
  homeLayout: 'calm',
  playerLayout: 'split',
  homeBlocks: DEFAULT_HOME_BLOCKS,
  motionPlayer: 'sheet',
  motionWave: 'breathe',
  motionScreens: 'fade',
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
  vkDisliked: [],
  sleepSuspendsPc: false,
  autoUpdate: true,
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
  miniDoubleClick: 'expand',
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
