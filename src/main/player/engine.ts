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
import { resolveStream, setLiked, wave, waveFeedback } from '../sources/registry'
import { readSession, writeSession } from '../state/session'
import { addDownloads, downloadedFile } from '../downloads/manager'
import { mediaUrl } from '../downloads/protocol'
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
 */
let wiredQueue: Track[] | null = null
export function wirePlayer(state: PlayerState): PlayerUpdate {
  if (state.queue === wiredQueue) return { ...state, queue: undefined }
  wiredQueue = state.queue
  return state
}

export function getPlayer(): PlayerState {
  return state
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
  patch({ queue: saved.queue, index: saved.index })
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
    writeSession({ queue: state.queue, index: state.index, positionMs: state.positionMs })
  }, SAVE_INTERVAL_MS)
}

const SAVE_INTERVAL_MS = 4000

export async function command(input: PlayerCommand): Promise<void> {
  switch (input.type) {
    case 'playQueue': {
      const tracks = input.tracks.filter((track) => track.available)
      if (tracks.length === 0) return
      // The clicked track must stay under the cursor even if unavailable rows
      // were dropped from in front of it.
      const clicked = input.tracks[input.startIndex]
      const index = Math.max(0, tracks.findIndex((track) => track.id === clicked?.id))
      unshuffled = null
      patch({ queue: tracks, index, shuffle: false, waveService: null })
      await loadCurrent(true)
      return
    }

    case 'playWave': {
      unshuffled = null
      patch({ queue: [], index: -1, shuffle: false, waveService: input.service, loading: true, error: null })
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

    case 'playIndex':
      if (input.index < 0 || input.index >= state.queue.length) return
      patch({ index: input.index })
      await loadCurrent(true)
      return

    case 'playPause':
      if (state.index < 0) return
      if (state.playing) controlAudio({ type: 'pause' })
      else controlAudio({ type: 'play' })
      return

    case 'play':
      if (state.index < 0) return
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

    case 'setOutputDevice':
      setSettings({ outputDeviceId: input.deviceId })
      patch({ outputDeviceId: input.deviceId })
      controlAudio({ type: 'setSink', deviceId: input.deviceId })
      return

    case 'setSleepTimer':
      startSleepTimer(input.minutes)
      return

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

/** Fold an event from the audio host into the state. */
export function handleAudioEvent(event: AudioEvent): void {
  switch (event.type) {
    case 'playing':
      hasStartedPlayingThisTrack = true
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

async function topUpWave(): Promise<void> {
  const choice = state.waveService
  if (!choice || toppingUp) return
  if (state.index < state.queue.length - 1 - WAVE_LOOKAHEAD) return

  toppingUp = true
  try {
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

/** Resolve the current track's stream and hand it to the audio host. */
async function loadCurrent(autoplay: boolean, startAtMs = 0): Promise<void> {
  const track = state.queue[state.index]
  if (!track) return

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
    const local = settings.preferDownloaded ? downloadedFile(track.id) : null
    const url = local ? mediaUrl(local) : await resolveStream(track)
    // A newer track was selected while this lookup was in flight.
    if (token !== loadToken) return
    controlAudio({ type: 'setSink', deviceId: getSettings().outputDeviceId })
    if (state.waveService) void waveFeedback(track.service, 'trackStarted', track)
    loadAudio({ url, positionMs: startAtMs, volume: state.volume, muted: state.muted, autoplay })
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
  state = { ...state, ...changes, sampledAt: Date.now() }
  scheduleSave()
  for (const listener of listeners) listener(state)
}
