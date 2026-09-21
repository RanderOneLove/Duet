import type { ServiceId, Track, WaveChoice } from './domain'
import type { JamQueueItem } from './jam'

/** How the queue advances when a track ends. */
export type RepeatMode = 'off' | 'all' | 'one'

/**
 * Everything the UI needs to draw the transport. Owned by the main process,
 * mirrored into the shell, the mini player and the tray.
 */
/**
 * What actually travels to a renderer. `queue` dominates the size of the state
 * — a library played end to end is thousands of tracks — yet it changes rarely,
 * while the position ticks four times a second. So it is sent only when it
 * changed, and renderers keep the last one they were given.
 */
export type PlayerUpdate = Omit<PlayerState, 'queue'> & { queue?: Track[] }

export interface PlayerState {
  /** The queue in play order; shuffling reorders this, not a separate index map. */
  queue: Track[]
  /** Index into `queue`, or -1 when nothing is loaded. */
  index: number
  playing: boolean
  /** True between "user pressed play" and the first audio frame. */
  loading: boolean
  positionMs: number
  durationMs: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  /**
   * Set while the queue is a service station rather than a fixed list — the
   * engine tops it up as it runs down, so the radio never ends.
   */
  waveService: WaveChoice | null
  /** Outputs the machine offers; the empty id means "system default". */
  outputDevices: { id: string; label: string }[]
  /** Which one is in use, '' while following the system default. */
  outputDeviceId: string
  /** When playback stops by itself, as a timestamp, or null when no timer. */
  sleepEndsAt: number | null
  /** Код сессии, за которой идём, или null когда слушаем сами. */
  following: string | null
  /** Ведомый видит это, когда у ведущего играет недоступный ему трек. */
  followError: string | null
  /** Умеет ли сервис играющего трека «не нравится». */
  canDislike: boolean
  /**
   * Трек, вокруг которого построена станция. null — это личная волна.
   * Нужен и для подписи на экране, и чтобы продолжать станцию после
   * перезапуска.
   */
  waveSeed: Track | null
  /** Открыта ли общая сессия у нас — то есть ведём ли мы её. */
  jamOpen: boolean
  /** Идём следом и держим пропуск: можно добавлять и переключать. */
  jamGuest: boolean
  /** Сколько человек слушает вместе с вами — 0, когда вы никого не ведёте. */
  listeners: number
  /**
   * Кто предложил трек, по его идентификатору.
   *
   * Живёт у ведущего: очередь у него своя, полная, а не хватает ей только
   * имён. Участник получает имена уже внутри `jamQueue`.
   */
  jamCredits: Record<string, string>
  /**
   * Ближайшие треки общей сессии — для того, у кого своей очереди нет.
   *
   * Участник не ведёт очередь: он видит чужую. Ведущему это поле не нужно, у
   * него есть `queue`.
   */
  jamQueue: JamQueueItem[]
  /** Set when the current track failed to load, cleared on the next track. */
  error: string | null
  /** Wall clock at which positionMs was sampled, for smooth interpolation. */
  sampledAt: number
}

export const EMPTY_PLAYER: PlayerState = {
  queue: [],
  index: -1,
  playing: false,
  loading: false,
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
  waveService: null,
  outputDevices: [],
  outputDeviceId: '',
  sleepEndsAt: null,
  following: null,
  followError: null,
  canDislike: false,
  waveSeed: null,
  jamOpen: false,
  jamGuest: false,
  listeners: 0,
  jamCredits: {},
  jamQueue: [],
  error: null,
  sampledAt: 0
}

export function currentTrack(state: PlayerState): Track | null {
  return state.index >= 0 && state.index < state.queue.length ? state.queue[state.index] : null
}

export function currentService(state: PlayerState): ServiceId | null {
  return currentTrack(state)?.service ?? null
}

export type PlayerCommand =
  | { type: 'playPause' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; positionMs: number }
  | { type: 'setVolume'; volume: number }
  | { type: 'toggleMute' }
  | { type: 'toggleShuffle' }
  | { type: 'cycleRepeat' }
  | { type: 'setRepeat'; mode: RepeatMode }
  /** Replace the queue with `tracks` and start at `startIndex`. */
  | {
      type: 'playQueue'
      tracks: Track[]
      startIndex: number
      /**
       * Включить список вперемешку. Не указано — сохраняется то, что человек
       * выбрал раньше: перемешивание это его настроение, а не свойство списка.
       */
      shuffle?: boolean
    }
  /** Start the service's endless station. */
  | { type: 'playWave'; service: WaveChoice }
  /**
   * Станция вокруг одного трека: «включить похожее и не останавливаться».
   * От «Похожего» отличается тем, что это не список, а бесконечная волна.
   */
  | { type: 'playTrackWave'; track: Track }
  | { type: 'setOutputDevice'; deviceId: string }
  /** null cancels a running timer. */
  | { type: 'setSleepTimer'; minutes: number | null }
  | { type: 'follow'; code: string; jam?: string }
  /** Открыть общую сессию: по второй ссылке можно добавлять и переключать. */
  | { type: 'openJam' }
  | { type: 'closeJam' }
  /** Выдать новый пропуск: прежние ссылки становятся недействительны. */
  | { type: 'rotateJam' }
  /** Участник просит ведущего поставить трек в общую очередь. */
  | { type: 'jamAdd'; tracks: Track[] }
  | { type: 'stopFollowing' }
  /** Jump to a position in the existing queue. */
  | { type: 'playIndex'; index: number }
  | { type: 'removeFromQueue'; index: number }
  /** Drag-to-reorder: move one queued track to another slot. */
  | { type: 'moveInQueue'; from: number; to: number }
  /** Drop everything and stop; the transport falls back to its idle state. */
  | { type: 'clearQueue' }
  /** Like or unlike whatever is playing, on its own service. */
  | { type: 'toggleLike' }
  /**
   * «Не нравится»: сказать сервису и сразу перейти к следующему. Слушать
   * дальше то, что только что отвергли, — не то, чего от этой кнопки ждут.
   */
  | { type: 'dislike' }
  | { type: 'enqueueNext'; tracks: Track[] }
