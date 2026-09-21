import type { ServiceId, Track } from '@shared/domain'
import {
  EMPTY_PLAYER,
  type PlayerCommand,
  type PlayerState,
  type PlayerUpdate,
  type RepeatMode
} from '@shared/player'
import type { AudioEvent } from '../../preload/audio'
import { controlAudio, loadAudio } from '../windows/audioHost'
import {
  canDislike,
  dislike,
  isServiceConnected,
  playableTrack,
  trackWave,
  resolveStream,
  setLiked,
  wave,
  waveFeedback
} from '../sources/registry'
import { startFollowing, stopFollowing } from '../together/follow'
import { resetPublishing } from '../together/host'
import { closeJam, openJam, rotateJam, sayToHost } from '../together/jam'
import { resolveSeed } from '../sources/registry'
import type { JamMessage } from '@shared/jam'
import type { SharedState } from '../together/host'
import { flushSession, readSession, writeSession } from '../state/session'
import { addDownloads, downloadedFile } from '../downloads/manager'
import { mediaUrl } from '../downloads/protocol'
import { userInfo } from 'node:os'
import { getSettings, setSettings } from '../state/settings'

/**
 * Owns the queue and the transport. The audio host only knows about one url at
 * a time; every decision about what plays next is made here.
 */

type Listener = (state: PlayerState) => void

let state: PlayerState = { ...EMPTY_PLAYER }
const listeners = new Set<Listener>()

/** Bumped on every track change so a slow stream lookup cannot win a race. */
let loadToken = 0

/** Queue order before shuffling, so turning shuffle off restores it. */
let unshuffled: Track[] | null = null

/**
 * Trim a broadcast down to what changed. Every window fetches the full state
 * once when it mounts, so dropping an unchanged queue never leaves one short.
 *
 * Each window needs its own tracker. Sharing one meant that whichever window
 * was served first marked the queue as sent, and the second never received it
 * at all — the mini player went on showing a track from an older queue while
 * its clock ticked against the new one.
 */
export function createPlayerWire(): (state: PlayerState) => PlayerUpdate {
  let sent: Track[] | null = null
  return (state) => {
    if (state.queue === sent) return { ...state, queue: undefined }
    sent = state.queue
    return state
  }
}

/**
 * Провод для мини-плеера. Он показывает ровно один трек, а получал очередь
 * целиком: при игре из библиотеки это несколько тысяч треков, которые
 * перекладываются через IPC в окно размером с ладонь и лежат там без дела.
 * Поэтому очередь здесь усекается до текущего трека — и уходит, как и в
 * большом проводе, только когда этот трек сменился.
 */
export function createMiniWire(): (state: PlayerState) => PlayerUpdate {
  let sent: string | null = null
  return (state) => {
    const track = state.queue[state.index] ?? null
    const index = track ? 0 : -1
    /*
     * Сравнивается не номер трека, а его содержимое.
     *
     * По одному номеру лайк не доезжал: он меняет признак внутри того же
     * трека, номер остаётся прежним, и провод считал, что посылать нечего.
     * Сердечко в плите загоралось только со сменой песни.
     */
    const signature = track ? `${track.id}|${track.liked}|${track.available}` : null
    if (signature === sent) return { ...state, queue: undefined, index }
    sent = signature
    return { ...state, queue: track ? [track] : [], index }
  }
}

/**
 * То же состояние, каким его видит плита, — для её первого запроса.
 *
 * Общий `getPlayer` отдавал очередь целиком и настоящий номер в ней, а провод
 * шлёт очередь из одного трека и номер ноль. Плита складывала одно с другим и
 * рисовала первый трек очереди вместо играющего — до ближайшей смены песни,
 * после которой ноль снова становился верным. Поэтому первый запрос идёт через
 * тот же провод: полной очереди у плиты не бывает никогда.
 */
export function getPlayerForMini(): PlayerUpdate {
  const track = state.queue[state.index] ?? null
  return { ...state, queue: track ? [track] : [], index: track ? 0 : -1 }
}

export function getPlayer(): PlayerState {
  return state
}

/**
 * Сколько человек слушает вместе. Приходит ответом ретранслятора на публикацию,
 * поэтому кладётся сюда снаружи, а не считается движком.
 */
export function reportListeners(count: number): void {
  if (state.listeners !== count) patch({ listeners: count })
}

/** Дописать сессию на выходе: асинхронная запись до закрытия может не успеть. */
export function saveSessionNow(): void {
  if (state.index < 0 || state.queue.length === 0) return
  flushSession({
    queue: state.queue,
    index: state.index,
    positionMs: state.positionMs,
    waveService: state.waveService,
    waveSeed: state.waveSeed
  })
}

export function onPlayerChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function initPlayer(volume: number, muted: boolean): void {
  patch({ volume, muted, outputDeviceId: getSettings().outputDeviceId })
}

/**
 * Bring back what was playing last time, loaded but paused at the same spot.
 * Runs after the sources are restored — resolving a stream needs a session.
 */
export async function restoreSession(): Promise<void> {
  if (state.queue.length > 0) return // the user already started something
  const saved = readSession()
  if (!saved) return
  // Вместе с очередью возвращается и станция: иначе приложение считает
  // бесконечный список обычным и останавливается, когда тот кончится.
  patch({
    queue: saved.queue,
    index: saved.index,
    waveService: saved.waveService,
    waveSeed: saved.waveSeed
  })
  // Resuming within a couple of seconds of the end just triggers `ended`.
  const duration = saved.queue[saved.index]?.durationMs ?? 0
  const startAt = duration > 0 && saved.positionMs > duration - 2000 ? 0 : saved.positionMs
  await loadCurrent(false, startAt)
}

/** Persist the queue, throttled — position ticks four times a second. */
let saveTimer: NodeJS.Timeout | null = null
function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (state.index < 0 || state.queue.length === 0) return
    writeSession({
      queue: state.queue,
      index: state.index,
      positionMs: state.positionMs,
      waveService: state.waveService,
      waveSeed: state.waveSeed
    })
  }, SAVE_INTERVAL_MS)
}

const SAVE_INTERVAL_MS = 4000

/** Команды, которыми слушатель заявляет о себе, — они и прекращают следование. */
const OWN_CHOICE = new Set<PlayerCommand['type']>([
  'playQueue',
  'playIndex',
  'playWave',
  'next',
  'prev',
  'seek'
])

export async function command(input: PlayerCommand): Promise<void> {
  /*
   * Пока идём следом, часть кнопок означает не то, что обычно.
   *
   * Перелистывание отключено: очередь здесь чужая, и «следующий» сбил бы с
   * толку — трек сменился бы на секунду, а потом ведущий вернул бы своё.
   * Пауза же означает «подключиться заново»: чаще всего её жмут, когда звук
   * разошёлся с ведущим, и ждут, что всё встанет на место, а не что
   * следование прекратится. Уйти от ведущего можно, включив своё.
   */
  if (state.following && !applyingFollowed && !applyingJam) {
    /*
     * В общей сессии переключать может каждый — но не у себя, а у ведущего:
     * музыка одна на всех, и своё переключение развалило бы её на два разных
     * прослушивания. Поэтому кнопка не делает, а просит.
     */
    if (state.jamGuest && (input.type === 'next' || input.type === 'prev')) {
      const passed = followJamPass
      const code = state.following
      void (async () => {
        const delivered = passed
          ? await sayToHost(code, passed, { type: input.type as 'next' | 'prev' })
          : false
        if (!delivered) patch({ followError: 'Ведущий сейчас не на связи — просьба не дошла' })
      })()
      return
    }
    if (input.type === 'next' || input.type === 'prev' || input.type === 'seek') {
      patch({ followError: 'Пока вы слушаете вместе, переключает ведущий' })
      return
    }
    if (input.type === 'playPause' || input.type === 'play' || input.type === 'pause') {
      resyncFollowing()
      return
    }
    if (OWN_CHOICE.has(input.type)) leaveFollowing()
  }

  /*
   * Сообщение про совместное прослушивание живёт до следующего действия.
   *
   * Его прочитали, нажали что-то своё — держать дальше незачем; закрыть его
   * человеку нечем, а висящая строка выглядит так, будто отказ всё ещё в силе.
   */
  if (!state.following && state.followError && !applyingFollowed) {
    patch({ followError: null })
  }

  switch (input.type) {
    case 'playQueue': {
      const tracks = input.tracks.filter((track) => track.available)
      if (tracks.length === 0) return
      // The clicked track must stay under the cursor even if unavailable rows
      // were dropped from in front of it.
      const clicked = input.tracks[input.startIndex]
      // Перемешивание — это настроение слушателя, а не свойство списка.
      // Сбрасывая его здесь, плеер гасил тумблер ровно в тот момент, когда им
      // только что воспользовались: включить перемешивание и нажать трек в
      // «Вам нравится» означало выключить перемешивание.
      const wantShuffle = input.shuffle ?? state.shuffle
      // «Слушать вперемешку» начинается со случайного трека, а не с первого:
      // иначе список каждый раз открывался бы одной и той же песней.
      const index =
        input.shuffle === true
          ? Math.floor(Math.random() * tracks.length)
          : Math.max(0, tracks.findIndex((track) => track.id === clicked?.id))

      unshuffled = null
      patch({ queue: tracks, index, shuffle: false, waveService: null, waveSeed: null })
      if (wantShuffle) patch(shuffleQueue())
      await loadCurrent(true)
      return
    }

    case 'playWave': {
      unshuffled = null
      patch({
        queue: [],
        index: -1,
        shuffle: false,
        waveService: input.service,
        waveSeed: null,
        loading: true,
        error: null
      })
      try {
        // Resume the station where it left off; starting it cold makes the
        // rotor hand back its opening batch again, the same one every time.
        const tracks = await wave(input.service, getSettings().waveCursors)
        rememberWaveCursor(tracks)
        const playable = tracks.filter((track) => track.available)
        if (playable.length === 0) throw new Error('Волна не вернула треков')
        patch({ queue: playable, index: 0 })
        if (input.service !== 'both') void waveFeedback(input.service, 'radioStarted')
        else for (const id of ['yandex', 'vk'] as const) void waveFeedback(id, 'radioStarted')
        await loadCurrent(true)
        void topUpWave()
      } catch (error) {
        patch({
          loading: false,
          waveService: null,
          error: error instanceof Error ? error.message : 'Не удалось запустить волну'
        })
      }
      return
    }

    case 'playTrackWave': {
      /*
       * Станция вокруг трека. Первым ставится он сам: её включают, слушая
       * именно эту песню, и услышать вместо неё похожую — не то, чего ждут.
       * Дальше идёт то, что подобрал сервис, без повтора начального трека.
       */
      unshuffled = null
      patch({
        queue: [input.track],
        index: 0,
        shuffle: false,
        waveService: input.track.service,
        waveSeed: input.track,
        loading: true,
        error: null
      })
      try {
        const tracks = await trackWave(input.track)
        const rest = tracks.filter((track) => track.available && track.id !== input.track.id)
        patch({ queue: [input.track, ...rest] })
        await loadCurrent(true)
        void topUpWave()
      } catch (error) {
        patch({
          loading: false,
          waveService: null,
          waveSeed: null,
          error: error instanceof Error ? error.message : 'Не удалось запустить волну по треку'
        })
      }
      return
    }

    case 'playIndex':
      if (input.index < 0 || input.index >= state.queue.length) return
      patch({ index: input.index })
      await loadCurrent(true)
      return

    /*
     * «Играть», когда играть нечего, — это просьба включить музыку, а не сбой.
     *
     * Так жмут из мини-плеера, не открывая окна: приложение только запустилось
     * или очередь кончилась. Если последним слушали волну, включается она же —
     * станция помнит, где остановилась, и продолжает с того места.
     */
    case 'playPause':
      if (state.index < 0) return resumeWave()
      if (state.playing) controlAudio({ type: 'pause' })
      else controlAudio({ type: 'play' })
      return

    case 'play':
      if (state.index < 0) return resumeWave()
      controlAudio({ type: 'play' })
      return

    case 'pause':
      controlAudio({ type: 'pause' })
      return

    case 'next':
      reportWaveTrack('skip')
      await advance(1, true)
      return

    case 'prev':
      // Matches every other player: rewind first, only step back near the start.
      if (state.positionMs > 3000) {
        controlAudio({ type: 'seek', positionMs: 0 })
        patch({ positionMs: 0 })
        return
      }
      await advance(-1, true)
      return

    case 'seek':
      controlAudio({ type: 'seek', positionMs: input.positionMs })
      patch({ positionMs: input.positionMs })
      return

    case 'setVolume':
      controlAudio({ type: 'setVolume', volume: input.volume })
      patch({ volume: input.volume, muted: false })
      return

    case 'toggleMute':
      controlAudio({ type: 'setMuted', muted: !state.muted })
      patch({ muted: !state.muted })
      return

    case 'toggleShuffle':
      patch(state.shuffle ? unshuffleQueue() : shuffleQueue())
      return

    case 'cycleRepeat':
      patch({ repeat: nextRepeat(state.repeat) })
      return

    case 'setRepeat':
      patch({ repeat: input.mode })
      return

    case 'enqueueNext': {
      if (state.queue.length === 0) {
        await command({ type: 'playQueue', tracks: input.tracks, startIndex: 0 })
        return
      }
      const queue = [...state.queue]
      queue.splice(state.index + 1, 0, ...input.tracks.filter((track) => track.available))
      patch({ queue })
      return
    }

    case 'toggleLike': {
      const track = state.queue[state.index]
      if (!track) return
      const liked = !track.liked
      try {
        await setLiked(track, liked)
        // Mirror it into the queue so every surface shows the new state.
        patch({
          queue: state.queue.map((item) => (item.id === track.id ? { ...item, liked } : item))
        })
        // A track worth keeping is worth keeping offline.
        if (liked && getSettings().autoDownload) void addDownloads([track], true)
      } catch (error) {
        patch({ error: error instanceof Error ? error.message : 'Не удалось изменить избранное' })
      }
      return
    }

    case 'dislike': {
      const track = state.queue[state.index]
      if (!track) return
      try {
        await dislike(track)
        // Отвергнутый трек уходит из очереди, а под курсором оказывается
        // следующий — поэтому не «шаг вперёд», а загрузка того, что встало на
        // освободившееся место.
        const queue = state.queue.filter((item) => item.id !== track.id)
        if (queue.length === 0) {
          patch({ queue })
          stop()
          return
        }
        patch({ queue, index: Math.min(state.index, queue.length - 1) })
        await loadCurrent(true)
        void topUpWave()
      } catch (error) {
        patch({ error: error instanceof Error ? error.message : 'Не удалось отметить трек' })
      }
      return
    }

    case 'setOutputDevice':
      setSettings({ outputDeviceId: input.deviceId })
      patch({ outputDeviceId: input.deviceId })
      controlAudio({ type: 'setSink', deviceId: input.deviceId })
      return

    case 'setSleepTimer':
      startSleepTimer(input.minutes)
      return

    case 'follow': {
      /*
       * По своей же ссылке идти некуда.
       *
       * Ссылку проверяют, прежде чем отправить, — и попадали в тупик: слушать
       * вместе с собой нечего, зато перелистывание, пауза и перемотка после
       * этого отвечают «переключает ведущий», а ведущий — вы сами. Выбраться
       * можно было только кнопкой «Отключиться», о которой в этот момент никто
       * не думает.
       */
      followJamPass = input.jam ?? null
      if (input.code === getSettings().togetherCode) {
        followJamPass = null
        patch({ followError: 'Это ваша же ссылка — вы и так слушаете то, что в ней' })
        return
      }

      const joined = await startFollowing(
        input.code,
        applyFollowed,
        () => {
          // Добиваться связи больше нечего: ведущий закрыл приложение.
          lastShared = null
          patch({ following: null, followError: null })
        },
        () => patch({ followError: RECONNECTING })
      )
      patch({
        following: joined ? input.code : null,
        jamGuest: joined && followJamPass !== null,
        followError: joined ? null : 'Сессия не найдена — возможно, её уже закрыли'
      })
      return
    }

    case 'stopFollowing':
      leaveFollowing()
      return

    case 'openJam': {
      const opened = await openJam(handleJamMessage)
      patch({
        jamOpen: opened,
        followError: opened ? null : 'Не вышло открыть общую сессию — нет связи с ретранслятором'
      })
      return
    }

    case 'closeJam':
      await closeJam()
      patch({ jamOpen: false })
      return

    case 'rotateJam': {
      const opened = await rotateJam(handleJamMessage)
      patch({
        jamOpen: opened,
        followError: opened ? 'Прежние ссылки больше не работают' : 'Не вышло сменить пропуск'
      })
      return
    }

    case 'jamAdd': {
      // Просьба уходит ведущему; своя очередь у участника не меняется —
      // иначе у него заиграло бы одно, а у всех остальных другое.
      const code = state.following
      if (!code || !followJamPass) {
        patch({ followError: 'Добавлять в общую очередь можно только по ссылке участника' })
        return
      }
      let delivered = 0
      for (const track of input.tracks) {
        const ok = await sayToHost(code, followJamPass, {
          type: 'add',
          from: jamName(),
          track: {
            title: track.title,
            artists: track.artists,
            durationMs: track.durationMs,
            service: track.service,
            nativeId: track.nativeId
          }
        })
        if (ok) delivered += 1
      }
      patch({
        followError:
          delivered > 0
            ? `Отправлено ведущему: ${delivered} ${delivered === 1 ? 'трек' : 'трека'}`
            : 'Ведущий сейчас не на связи — просьба не дошла'
      })
      return
    }

    case 'clearQueue':
      unshuffled = null
      patch({ queue: [], index: -1, shuffle: false })
      stop()
      return

    case 'moveInQueue': {
      const { from, to } = input
      const last = state.queue.length - 1
      if (from === to || from < 0 || from > last || to < 0 || to > last) return
      const current = state.queue[state.index]
      const queue = [...state.queue]
      const [moved] = queue.splice(from, 1)
      queue.splice(to, 0, moved)
      // Follow the playing track rather than the slot it used to sit in.
      patch({ queue, index: current ? queue.indexOf(current) : state.index })
      return
    }

    case 'removeFromQueue': {
      if (input.index < 0 || input.index >= state.queue.length) return
      const queue = state.queue.filter((_, i) => i !== input.index)
      if (input.index < state.index) {
        patch({ queue, index: state.index - 1 })
      } else if (input.index === state.index) {
        patch({ queue, index: Math.min(state.index, queue.length - 1) })
        if (queue.length === 0) stop()
        else await loadCurrent(state.playing)
      } else {
        patch({ queue })
      }
      return
    }
  }
}

/**
 * Сторож у загрузки.
 *
 * Ошибку плеер умел пережить и раньше: ссылка протухла — перезапросить и
 * продолжить. Но трек может не заиграть и молча: элемент вечно «ждёт данных»,
 * ошибки нет, а музыки нет тоже. Об этом и жалоба «иногда останавливается само
 * и не продолжает» — восстанавливаться было нечему.
 *
 * Поэтому у каждой загрузки есть срок. Не зазвучало за него — считаем неудачей
 * и пробуем иначе: сначала мимо скачанного файла (он может быть негодным), а
 * если и так молчит — дальше по очереди, чтобы тишина не была окончательной.
 */
const START_TIMEOUT_MS = 8000
let startTimer: NodeJS.Timeout | null = null

/**
 * Скачанные копии, которым мы больше не верим. Файл на диске выглядит готовым
 * и при этом может не играть — тогда сеть надёжнее собственного архива.
 */
const distrustedFiles = new Set<string>()

/** Сколько треков подряд не зазвучало. Обрыв сети не должен промотать очередь. */
let consecutiveFailures = 0
const MAX_CONSECUTIVE_FAILURES = 3

function clearStartWatchdog(): void {
  if (startTimer) clearTimeout(startTimer)
  startTimer = null
}

function armStartWatchdog(token: number): void {
  clearStartWatchdog()
  startTimer = setTimeout(() => {
    startTimer = null
    if (token !== loadToken || hasStartedPlayingThisTrack) return
    void giveUpOnSilence()
  }, START_TIMEOUT_MS)
}

/** Трек молчит дольше положенного — решить, что с этим делать. */
async function giveUpOnSilence(): Promise<void> {
  const track = state.queue[state.index]
  if (!track) return

  // Играли с диска — попробовать то же самое из сети.
  const fromFile = getSettings().preferDownloaded && !distrustedFiles.has(track.id)
  if (fromFile && downloadedFile(track.id)) {
    distrustedFiles.add(track.id)
    await loadCurrent(true, state.positionMs)
    return
  }

  if (retryPlayback()) return

  consecutiveFailures += 1
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    patch({
      loading: false,
      playing: false,
      error: 'Треки не начинают играть — похоже, пропала сеть'
    })
    return
  }

  patch({ error: `«${track.title}» не начал играть — пропускаем` })
  await advance(1, false)
}

/** One automatic retry per track, so a broken link cannot spin forever. */
let retriedTrackId: string | null = null
let retriedAt = 0
const RETRY_GAP_MS = 15_000

function retryPlayback(): boolean {
  const track = state.queue[state.index]
  if (!track) return false
  const now = Date.now()
  if (retriedTrackId === track.id && now - retriedAt < RETRY_GAP_MS) return false

  retriedTrackId = track.id
  retriedAt = now
  // Повтор случается как раз потому, что ссылка перестала работать: взятую
  // заранее надо забыть, иначе вторая попытка пойдёт по той же мёртвой.
  prefetched.delete(track.id)
  void loadCurrent(true, state.positionMs)
  return true
}

let hasStartedPlayingThisTrack = false

/**
 * Stop playing after a while. The deadline lives in the state rather than only
 * in the timer, so the UI can count down without asking, and a timer set twice
 * replaces the first rather than stacking.
 */
let sleepTimer: NodeJS.Timeout | null = null

function startSleepTimer(minutes: number | null): void {
  if (sleepTimer) clearTimeout(sleepTimer)
  sleepTimer = null

  if (minutes === null || !(minutes > 0)) {
    patch({ sleepEndsAt: null })
    return
  }

  const ms = Math.round(minutes * 60_000)
  sleepTimer = setTimeout(() => {
    sleepTimer = null
    patch({ sleepEndsAt: null })
    // Pausing rather than stopping keeps the track and position, so carrying
    // on later is one press.
    if (state.playing) controlAudio({ type: 'pause' })
    if (getSettings().sleepSuspendsPc) suspendMachine()
  }, ms)
  patch({ sleepEndsAt: Date.now() + ms })
}

/**
 * Ask Windows to sleep. Done through the power profile helper rather than
 * `shutdown`, which cannot suspend — and after the pause above, so the track
 * is already saved if the machine goes down mid-write.
 */
function suspendMachine(): void {
  if (process.platform !== 'win32') return
  const { spawn } = require('node:child_process') as typeof import('node:child_process')
  try {
    spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  } catch {
    // Nothing to do if the machine refuses; the music has stopped regardless.
  }
}

/**
 * Расхождение, ниже которого подгонять не стоит: перемотка ради полусекунды
 * слышна как заикание, а несовпадение — нет.
 */
const SYNC_TOLERANCE_MS = 2000

/** Пока это поднято, команды движка идут от ведущего, а не от слушателя. */
let applyingFollowed = false

function leaveFollowing(): void {
  lastShared = null
  followJamPass = null
  if (state.jamGuest || state.jamQueue.length > 0) patch({ jamGuest: false, jamQueue: [] })
  stopFollowing()
  if (state.following || state.followError) patch({ following: null, followError: null })
}

/** Последнее, что прислал ведущий, — по нему и подключаемся заново. */
let lastShared: SharedState | null = null

/**
 * Встать на то место, где ведущий сейчас.
 *
 * Нужно, когда звук разошёлся: сеть моргнула, трек грузился дольше обычного.
 * Пересчитываем позицию от момента последнего сообщения — часы ведущего с тех
 * пор не стояли.
 */
function resyncFollowing(): void {
  if (!lastShared) return
  applyFollowed(lastShared)
}

/** Пропуск, по которому мы сами участвуем в чужой сессии. */
let followJamPass: string | null = null

/**
 * Просьба участника, пришедшая ведущему.
 *
 * Трек приезжает описанием, а не номером, и ищется здесь — у того, кто его
 * будет играть. Если не нашёлся ни у одного нашего сервиса, молчать нельзя:
 * участник нажал кнопку и ждёт, что песня появится в очереди.
 */
let applyingJam = false

/**
 * Под каким именем участник подписывает добавленное.
 *
 * Имя пользователя системы — разумная замена: оно уже есть, его не надо
 * спрашивать, и в очереди из нескольких человек оно различает их лучше, чем
 * одинаковое «участник». Настройка его перекрывает.
 */
function jamName(): string {
  const chosen = getSettings().jamName.trim()
  if (chosen) return chosen.slice(0, 24)
  try {
    return (userInfo().username || 'участник').slice(0, 24)
  } catch {
    return 'участник'
  }
}

function handleJamMessage(message: JamMessage): void {
  void (async () => {
    /*
     * Просьба участника — это решение ведущего, а не его собственное нажатие,
     * и проверки «пока вы слушаете вместе» её не касаются. Ведущий, который сам
     * идёт за кем-то третьим, иначе отправлял бы просьбу дальше по цепочке
     * вместо того, чтобы выполнить.
     */
    applyingJam = true
    try {
      if (message.type === 'next' || message.type === 'prev') {
        await command({ type: message.type })
        return
      }
      if (message.type !== 'add') return

      const track = await resolveSeed(message.track)
      if (!track) {
        patch({ followError: `«${message.track.title}» не нашёлся ни в VK, ни в Яндексе` })
        return
      }
      await command({ type: 'enqueueNext', tracks: [track] })
      // Имя предложившего — то, ради чего очередь вообще показывают: иначе
      // общая сессия выглядит как очередь ведущего, в которую что-то падает.
      const by = (message.from ?? '').trim() || 'участник'
      patch({
        jamCredits: { ...state.jamCredits, [track.id]: by },
        followError: `${by} добавил: «${track.title}»`
      })
    } finally {
      applyingJam = false
    }
  })()
}

/** Что показывается, пока связь с ведущим восстанавливается. */
const RECONNECTING = 'Связь с ведущим прервалась — восстанавливаем…'

/**
 * Состояния применяются по одному и только самое свежее.
 *
 * Между приходом состояния и его применением есть ожидание: трек надо
 * загрузить. Если за это время придёт следующее, прежний порядок запускал
 * второй разбор поверх первого — и флаг «это не своя команда» снимался, пока
 * первый ещё шёл, отчего собственные действия движка принимались за выбор
 * человека и следование обрывалось. Промежуточные состояния при этом не нужны:
 * догонять надо туда, где ведущий сейчас.
 */
let pendingShared: SharedState | null = null
let draining = false

function applyFollowed(shared: SharedState): void {
  lastShared = shared
  pendingShared = shared
  /*
   * Очередь и число слушающих применяются сразу, не дожидаясь очереди на
   * загрузку трека: это не воспроизведение, а то, что видно на экране, и
   * добавленный кем-то трек должен появиться в списке тут же.
   */
  patch({ jamQueue: shared.next ?? [], listeners: shared.listeners ?? 0 })
  if (state.followError === RECONNECTING) patch({ followError: null })
  if (!draining) void drainFollowed()
}

async function drainFollowed(): Promise<void> {
  draining = true
  applyingFollowed = true
  try {
    while (pendingShared) {
      const shared = pendingShared
      pendingShared = null
      await applyOneFollowed(shared)
    }
  } finally {
    applyingFollowed = false
    draining = false
  }
}

/** Принять состояние ведущего и привести своё воспроизведение к нему. */
async function applyOneFollowed(shared: SharedState): Promise<void> {
  let track = shared.track
  if (!track) {
    controlAudio({ type: 'pause' })
    return
  }

  // Пока сообщение шло, время не стояло.
  const target = shared.positionMs + (shared.playing ? Date.now() - shared.at : 0)
  const current = state.queue[state.index]

  if (current?.id !== track.id) {
    /*
     * Ведущий может слушать из сервиса, к которому мы не подключены. Раньше это
     * был тупик: очередь и подпись переключались, а звук оставался прежним — на
     * экране Яндекс, в наушниках всё ещё VK. Теперь та же песня ищется у своего
     * сервиса, и следование продолжается.
     */
    if (!isServiceConnected(track.service) || !track.available) {
      const twin = await playableTrack(track)
      if (twin.id === track.id) {
        patch({ followError: `«${track.title}» не нашёлся у вашего сервиса — пропускаем` })
        return
      }
      track = twin
    }
    patch({ queue: [track], index: 0, waveService: null, followError: null })
    await loadCurrent(shared.playing, Math.max(0, target))
    return
  }

  const drift = Math.abs(state.positionMs - target)
  if (drift > SYNC_TOLERANCE_MS) controlAudio({ type: 'seek', positionMs: Math.max(0, target) })
  if (shared.playing && !state.playing) controlAudio({ type: 'play' })
  if (!shared.playing && state.playing) controlAudio({ type: 'pause' })
}

/** Fold an event from the audio host into the state. */
export function handleAudioEvent(event: AudioEvent): void {
  switch (event.type) {
    case 'playing':
      /*
       * Трек зазвучал по-настоящему. Между переключением и этим мгновением
       * проходит загрузка — секунда, иногда больше, — и слушающий вместе всё
       * это время считает, что песня уже идёт. Забываем последнюю отправку,
       * чтобы следующая, которая уйдёт прямо сейчас, сообщила настоящее
       * начало, а не предсказанное.
       */
      if (!hasStartedPlayingThisTrack) resetPublishing()
      hasStartedPlayingThisTrack = true
      clearStartWatchdog()
      consecutiveFailures = 0
      patch({ playing: true, loading: false, error: null, positionMs: event.positionMs ?? state.positionMs })
      return
    case 'paused':
      patch({ playing: false, positionMs: event.positionMs ?? state.positionMs })
      return
    case 'ready':
      patch({
        loading: false,
        // Trust the decoder's duration over the catalogue's.
        durationMs: event.durationMs || state.durationMs,
        positionMs: event.positionMs ?? state.positionMs
      })
      return
    case 'progress':
      patch({ positionMs: event.positionMs ?? state.positionMs, durationMs: event.durationMs || state.durationMs })
      return
    case 'devices':
      patch({ outputDevices: event.devices ?? [] })
      return
    case 'ended':
      void handleEnded()
      return
    case 'stalled':
      // Still "playing" as far as the queue goes, but nothing is coming out.
      patch({ loading: true, positionMs: event.positionMs ?? state.positionMs })
      return
    case 'error':
      // Both services hand out short-lived links, so a track that has been
      // sitting in the queue can fail mid-playback through no fault of its
      // own. Re-resolve it once and carry on from where it stopped; only a
      // second failure on the same track is reported as an error.
      if (retryPlayback()) return
      patch({ playing: false, loading: false, error: event.message ?? 'Ошибка воспроизведения' })
      return
  }
}

async function handleEnded(): Promise<void> {
  // A track restored at startup sits paused, and seeking into it can emit
  // `ended` on its own. Only something that was genuinely playing may advance
  // the queue — otherwise the app would start playing the moment it opened.
  if (!hasStartedPlayingThisTrack) return
  hasStartedPlayingThisTrack = false

  if (state.repeat === 'one') {
    controlAudio({ type: 'seek', positionMs: 0 })
    controlAudio({ type: 'play' })
    return
  }
  reportWaveTrack('trackFinished')
  await advance(1, false)
}

/**
 * Step through the queue. `manual` distinguishes pressing Next (which wraps
 * only with repeat-all, and always plays) from a track simply finishing.
 */
async function advance(direction: 1 | -1, manual: boolean): Promise<void> {
  if (state.queue.length === 0) return
  const next = state.index + direction

  if (next >= state.queue.length) {
    if (state.waveService) {
      // The station is still fetching; try again once the batch lands.
      await topUpWave()
      if (next < state.queue.length) {
        patch({ index: next })
        await loadCurrent(true)
      }
      return
    }
    if (state.repeat === 'all') {
      patch({ index: 0 })
      await loadCurrent(true)
      return
    }
    // End of queue: stay on the last track, paused at its start.
    if (!manual) {
      controlAudio({ type: 'pause' })
      controlAudio({ type: 'seek', positionMs: 0 })
      patch({ playing: false, positionMs: 0 })
    }
    return
  }

  if (next < 0) {
    if (state.repeat !== 'all') {
      controlAudio({ type: 'seek', positionMs: 0 })
      patch({ positionMs: 0 })
      return
    }
    patch({ index: state.queue.length - 1 })
    await loadCurrent(true)
    return
  }

  patch({ index: next })
  await loadCurrent(true)
  void topUpWave()
}

/**
 * Stations hand out a few tracks at a time. Fetch the next batch once the
 * cursor is near the end, so playing a wave never stops on its own.
 */
const WAVE_LOOKAHEAD = 2
let toppingUp = false

/** Note where each station got to, so the next launch continues from there. */
function rememberWaveCursor(tracks: Track[]): void {
  const cursors = { ...getSettings().waveCursors }
  let changed = false
  for (const track of tracks) {
    if (cursors[track.service] === track.nativeId) continue
    cursors[track.service] = track.nativeId
    changed = true
  }
  if (changed) setSettings({ waveCursors: cursors })
}

/** The last track each service contributed to the queue. */
function cursorsFromQueue(): Partial<Record<ServiceId, string>> {
  const cursors: Partial<Record<ServiceId, string>> = {}
  for (const track of state.queue) cursors[track.service] = track.nativeId
  return cursors
}

/**
 * Включить ту волну, которую слушали последней.
 *
 * Отвечает молча, если её не было: обещать музыку, которой неоткуда взяться,
 * хуже, чем не откликнуться, — человек хотя бы поймёт, что надо выбрать самому.
 */
async function resumeWave(): Promise<void> {
  // Станция вокруг трека возвращается той же станцией, а не личной волной.
  const seed = state.waveSeed
  if (seed) {
    await command({ type: 'playTrackWave', track: seed })
    return
  }
  const choice = state.waveService
  if (!choice) return
  await command({ type: 'playWave', service: choice })
}

async function topUpWave(): Promise<void> {
  const choice = state.waveService
  if (!choice || toppingUp) return
  if (state.index < state.queue.length - 1 - WAVE_LOOKAHEAD) return

  toppingUp = true
  try {
    // Станция вокруг трека продолжается от последнего выданного — так она и
    // уходит от начальной песни, вместо того чтобы кружить возле неё.
    const seed = state.waveSeed
    if (seed) {
      const last = state.queue[state.queue.length - 1]
      const next = await trackWave(seed, last?.nativeId)
      const known = new Set(state.queue.map((track) => track.id))
      const fresh = next.filter((track) => track.available && !known.has(track.id))
      if (fresh.length > 0) patch({ queue: [...state.queue, ...fresh] })
      return
    }
    // Each station continues from the last track it gave us, which for a woven
    // wave is not the same as the last track in the queue.
    const next = await wave(choice, cursorsFromQueue())
    const known = new Set(state.queue.map((track) => track.id))
    const fresh = next.filter((track) => track.available && !known.has(track.id))
    if (fresh.length > 0) patch({ queue: [...state.queue, ...fresh] })
    rememberWaveCursor(next)
  } catch {
    // A failed top-up is not worth interrupting playback for; the next
    // track change tries again.
  } finally {
    toppingUp = false
  }
}

/**
 * Tell the station what became of the track that was playing. Measured: with
 * only the `queue` cursor the rotor hands back the same opening batch every
 * time — it is these reports that make the wave move on, so a station left
 * uninformed replays its first track on every launch.
 */
function reportWaveTrack(event: 'trackFinished' | 'skip'): void {
  if (!state.waveService) return
  const track = state.queue[state.index]
  if (!track) return
  void waveFeedback(track.service, event, track, state.positionMs / 1000)
}

/**
 * Запас ссылок на то, что заиграет следующим.
 *
 * Ссылку на поток оба сервиса выдают короткоживущей, поэтому она всегда
 * бралась в момент, когда трек уже нужен, — и это время человек слышит как
 * паузу: у Яндекса это два последовательных запроса подряд, у VK — поход за
 * манифестом. Здесь она берётся заранее, пока играет предыдущий трек.
 */
const PREFETCH_TTL_MS = 3 * 60 * 1000
/** Больше держать незачем: очередь идёт вперёд, а ссылки протухают. */
const PREFETCH_MAX = 12

const prefetched = new Map<string, { url: string; at: number }>()
let prefetching: string | null = null

function cachedStream(trackId: string): string | null {
  const hit = prefetched.get(trackId)
  if (!hit) return null
  if (Date.now() - hit.at > PREFETCH_TTL_MS) {
    prefetched.delete(trackId)
    return null
  }
  return hit.url
}

/**
 * Приготовить следующий трек: узнать ссылку и отдать её хосту, чтобы тот начал
 * буферизовать звук вторым элементом. Молча ничего не делает, если незачем.
 */
async function prefetchNext(): Promise<void> {
  const next = state.queue[state.index + 1]
  if (!next || !next.available) return
  if (prefetching === next.id) return

  // Скачанный файл ссылки не требует, но подогреть его стоит наравне с сетевым.
  const local = getSettings().preferDownloaded ? downloadedFile(next.id) : null
  if (local) {
    controlAudio({ type: 'preload', url: mediaUrl(local) })
    return
  }

  const known = cachedStream(next.id)
  if (known) {
    controlAudio({ type: 'preload', url: known })
    return
  }

  prefetching = next.id
  try {
    const url = await resolveStream(next)
    prefetched.set(next.id, { url, at: Date.now() })
    if (prefetched.size > PREFETCH_MAX) {
      const oldest = [...prefetched.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) prefetched.delete(oldest[0])
    }
    // Очередь могла уйти вперёд, пока мы ходили за ссылкой.
    if (state.queue[state.index + 1]?.id === next.id) {
      controlAudio({ type: 'preload', url })
    }
  } catch {
    // Не вышло — узнаем об этом в свой черёд, обычной загрузкой.
  } finally {
    if (prefetching === next.id) prefetching = null
  }
}

/** Resolve the current track's stream and hand it to the audio host. */
async function loadCurrent(autoplay: boolean, startAtMs = 0): Promise<void> {
  let track = state.queue[state.index]
  if (!track) return

  /*
   * Трек своего сервиса может быть недоступен, а чужой — прийти из совместного
   * прослушивания или из чужой очереди. Раньше и то и другое кончалось тишиной
   * с сообщением; теперь та же песня ищется у второго сервиса.
   *
   * Подменяется строка очереди, а не одна ссылка на поток: дальше по этому
   * треку пойдут и лайк, и текст, и подпись в Discord, и все они должны
   * указывать на то, что звучит на самом деле.
   */
  if (!track.available || !isServiceConnected(track.service)) {
    const playable = await playableTrack(track)
    if (playable.id !== track.id) {
      const queue = [...state.queue]
      queue[state.index] = playable
      patch({ queue })
      track = playable
    }
  }

  hasStartedPlayingThisTrack = false
  const token = ++loadToken
  patch({ loading: true, error: null, positionMs: startAtMs, durationMs: track.durationMs })

  try {
    // A downloaded copy plays instantly and survives a dead network.
    const settings = getSettings()
    // Keep what is being listened to, so it is there the next time offline.
    // Liking a track downloads it in either scope; this is the wider rule.
    if (settings.autoDownload && settings.autoDownloadScope === 'played') {
      void addDownloads([track], true)
    }
    const local =
      settings.preferDownloaded && !distrustedFiles.has(track.id)
        ? downloadedFile(track.id)
        : null
    // Ссылка, взятая заранее, избавляет от похода в сеть именно здесь — в
    // промежутке между треками, который слышно.
    const url = local ? mediaUrl(local) : cachedStream(track.id) ?? (await resolveStream(track))
    // A newer track was selected while this lookup was in flight.
    if (token !== loadToken) return
    controlAudio({ type: 'setSink', deviceId: getSettings().outputDeviceId })
    if (state.waveService) void waveFeedback(track.service, 'trackStarted', track)
    loadAudio({ url, positionMs: startAtMs, volume: state.volume, muted: state.muted, autoplay })
    // Загруженный, но не зазвучавший трек — это тишина без ошибки.
    if (autoplay) armStartWatchdog(token)
    // Пока играет этот, взять ссылку на следующий.
    void prefetchNext()
  } catch (error) {
    if (token !== loadToken) return
    patch({
      loading: false,
      playing: false,
      error: error instanceof Error ? error.message : 'Не удалось получить ссылку на трек'
    })
  }
}

function stop(): void {
  hasStartedPlayingThisTrack = false
  clearStartWatchdog()
  loadToken++
  controlAudio({ type: 'stop' })
  patch({ playing: false, loading: false, index: -1, positionMs: 0, durationMs: 0 })
}

function shuffleQueue(): Partial<PlayerState> {
  const current = state.queue[state.index]
  unshuffled = state.queue
  // Fisher-Yates over everything but the playing track, which moves to the front
  // so the current song is not interrupted by turning shuffle on.
  const rest = state.queue.filter((_, i) => i !== state.index)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return { queue: current ? [current, ...rest] : rest, index: current ? 0 : -1, shuffle: true }
}

function unshuffleQueue(): Partial<PlayerState> {
  const current = state.queue[state.index]
  const queue = unshuffled ?? state.queue
  unshuffled = null
  const index = current ? queue.findIndex((track) => track.id === current.id) : -1
  return { queue, index: index >= 0 ? index : 0, shuffle: false }
}

function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'
}

function patch(changes: Partial<PlayerState>): void {
  const previous = state.queue[state.index]
  state = { ...state, ...changes, sampledAt: Date.now() }
  // Признак живёт рядом с треком: он про сервис, из которого тот пришёл.
  const current = state.queue[state.index]

  /*
   * Сменился трек — отсчёт начинается заново.
   *
   * Переход к следующему шёл в два приёма: сперва сдвигался курсор очереди,
   * и только потом, дождавшись ссылки на поток, загрузка ставила позицию в
   * ноль. Между этими приёмами состояние успевало разойтись по слушателям —
   * новый трек и время от предыдущего, — и тот, кто слушал вместе, начинал
   * песню с середины. Позиция сбрасывается здесь, рядом со сменой курсора,
   * чтобы такого промежутка не было вовсе. Явно переданное время не трогаем:
   * им продолжают прослушивание с сохранённого места и догоняют ведущего.
   */
  if (current?.id !== previous?.id && changes.positionMs === undefined) {
    state.positionMs = 0
  }
  state.canDislike = current ? canDislike(current.service) : false

  /*
   * Имена предложивших живут ровно столько, сколько их треки в очереди.
   * Иначе список рос бы весь сеанс и уезжал на диск вместе с сессией.
   */
  if (changes.queue && Object.keys(state.jamCredits).length > 0) {
    const inQueue = new Set(state.queue.map((track) => track.id))
    const kept = Object.entries(state.jamCredits).filter(([id]) => inQueue.has(id))
    if (kept.length !== Object.keys(state.jamCredits).length) {
      state.jamCredits = Object.fromEntries(kept)
    }
  }

  scheduleSave()
  for (const listener of listeners) listener(state)
}
