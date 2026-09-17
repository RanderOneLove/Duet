import Hls from 'hls.js'

/**
 * The audio host. A hidden window whose only job is to own the media elements,
 * so playback never depends on whether the UI window is shown, hidden to the
 * tray, or busy rendering a long list.
 *
 * There are two elements, not one. Одного означало, что каждая смена трека
 * начинается с нуля: открыть ссылку, дождаться первых байтов и только потом
 * звук — намерено 120–190 мс тишины между треками. Запасной элемент грузит то,
 * что очередь называет следующим, и смена трека подменяет элементы местами.
 */

interface Slot {
  audio: HTMLAudioElement
  hls: Hls | null
  /** Что в этом элементе лежит, или null, когда он пуст. */
  url: string | null
}

function makeSlot(): Slot {
  const audio = new Audio()
  audio.preload = 'auto'
  return { audio, hls: null, url: null }
}

let current = makeSlot()
let spare = makeSlot()
let generation = 0

/** Громкость принадлежит плееру, а не тому элементу, который сейчас звучит. */
let volume = 1
let muted = false
let wantedSink = ''

window.audioHost.onLoad(({ url, positionMs, volume: wanted, muted: quiet, autoplay }) => {
  const mine = ++generation
  volume = wanted
  muted = quiet

  // Уже наготове: подменяем элементы вместо того, чтобы грузить заново.
  if (spare.url === url) {
    const old = current
    current = spare
    spare = old
    release(spare)
    apply(current)
    startAt(current, positionMs)
    if (autoplay) play(current, mine)
    return
  }

  release(spare)
  load(current, url, mine)
  apply(current)
  startAt(current, positionMs)
  if (autoplay) play(current, mine)
})

window.audioHost.onControl((command) => {
  switch (command.type) {
    case 'play':
      play(current, generation)
      return
    case 'pause':
      current.audio.pause()
      return
    case 'seek':
      if (Number.isFinite(current.audio.duration)) {
        current.audio.currentTime = Math.max(
          0,
          Math.min(current.audio.duration, command.positionMs / 1000)
        )
      }
      return
    case 'setVolume':
      volume = Math.max(0, Math.min(1, command.volume))
      current.audio.volume = volume
      return
    case 'setMuted':
      muted = command.muted
      current.audio.muted = muted
      return
    case 'setSink':
      void applySink(command.deviceId)
      return
    case 'preload':
      preload(command.url)
      return
    case 'stop':
      current.audio.pause()
      release(current)
      release(spare)
      return
  }
})

/** Отдать элементу источник. Шифрованный HLS разбирает hls.js, остальное — сам. */
function load(slot: Slot, url: string, mine: number): void {
  release(slot)
  slot.url = url

  if (url.includes('.m3u8') && Hls.isSupported()) {
    const hls = new Hls()
    slot.hls = hls
    hls.loadSource(url)
    hls.attachMedia(slot.audio)
    hls.on(Hls.Events.ERROR, (_, data) => {
      // О беде сообщает только тот элемент, который сейчас слышно: запасной
      // молчит — его ссылка ещё может и не понадобиться.
      if (data.fatal && slot === current && mine === generation) {
        window.audioHost.event({ type: 'error', message: `HLS error: ${data.details}` })
      }
    })
    return
  }

  slot.audio.src = url
  slot.audio.load()
}

/** Начать буферизовать следующий трек, не трогая то, что играет. */
function preload(url: string): void {
  if (spare.url === url || current.url === url) return
  load(spare, url, generation)
  spare.audio.pause()
  // Запасной всегда нем: громкость ему выставляется при подмене.
  spare.audio.muted = true
}

function release(slot: Slot): void {
  if (slot.hls) {
    slot.hls.destroy()
    slot.hls = null
  }
  slot.audio.removeAttribute('src')
  slot.audio.load()
  slot.url = null
}

function apply(slot: Slot): void {
  slot.audio.volume = volume
  slot.audio.muted = muted
  if (wantedSink) void setSink(slot, wantedSink)
}

function startAt(slot: Slot, positionMs: number): void {
  if (positionMs <= 0) return
  const seconds = positionMs / 1000
  if (slot.audio.readyState > 0) {
    slot.audio.currentTime = seconds
    return
  }
  // currentTime only sticks once metadata is in; set it again when it lands.
  slot.audio.addEventListener(
    'loadedmetadata',
    () => {
      slot.audio.currentTime = seconds
    },
    { once: true }
  )
}

function play(slot: Slot, mine: number): void {
  void slot.audio.play().catch((error: unknown) => {
    if (mine !== generation) return
    window.audioHost.event({ type: 'error', message: describe(error) })
  })
}

// ---- отчёт о том, что слышно ----

const report = (type: 'progress' | 'playing' | 'paused' | 'ended' | 'ready' | 'stalled'): void =>
  window.audioHost.event({
    type,
    positionMs: Math.round(current.audio.currentTime * 1000),
    durationMs: Number.isFinite(current.audio.duration)
      ? Math.round(current.audio.duration * 1000)
      : 0
  })

/**
 * События вешаются на оба элемента, но наружу уходят только от звучащего:
 * запасной, пока грузится, тоже шлёт 'canplay' и 'durationchange', и без этой
 * проверки плеер узнавал бы длительность следующего трека вместо текущего.
 */
function watch(slot: Slot): void {
  const mineOnly =
    (run: () => void) =>
    (): void => {
      if (slot === current) run()
    }
  slot.audio.addEventListener('playing', mineOnly(() => report('playing')))
  // Buffering: the element is "not paused" but the clock is not moving, so the
  // UI must stop interpolating or the bar creeps forward on a silent track.
  slot.audio.addEventListener('waiting', mineOnly(() => report('stalled')))
  slot.audio.addEventListener('stalled', mineOnly(() => report('stalled')))
  slot.audio.addEventListener('pause', mineOnly(() => report('paused')))
  slot.audio.addEventListener('ended', mineOnly(() => report('ended')))
  slot.audio.addEventListener('canplay', mineOnly(() => report('ready')))
  slot.audio.addEventListener('durationchange', mineOnly(() => report('ready')))
  slot.audio.addEventListener(
    'error',
    mineOnly(() =>
      window.audioHost.event({ type: 'error', message: mediaErrorText(slot.audio.error?.code) })
    )
  )
}

watch(current)
watch(spare)

// The UI interpolates between samples, so four a second is plenty.
setInterval(() => {
  if (!current.audio.paused) report('progress')
}, 250)

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mediaErrorText(code: number | undefined): string {
  switch (code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Загрузка прервана'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Ошибка сети при загрузке трека'
    case MediaError.MEDIA_ERR_DECODE:
      return 'Не удалось декодировать трек'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      // Almost always an expired stream url rather than a real format problem.
      return 'Ссылка на трек недействительна'
    default:
      return 'Неизвестная ошибка воспроизведения'
  }
}

/**
 * Which speakers the music comes out of. Chromium routes an element with
 * `setSinkId`; an empty id hands it back to whatever the system is using.
 */
async function applySink(deviceId: string): Promise<void> {
  wantedSink = deviceId
  // Оба элемента: подмена не должна возвращать звук в системное устройство.
  await Promise.all([setSink(current, deviceId), setSink(spare, deviceId)])
}

async function setSink(slot: Slot, deviceId: string): Promise<void> {
  const element = slot.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (!element.setSinkId) return
  try {
    await element.setSinkId(deviceId)
  } catch {
    // The device was unplugged between listing and selecting; the system
    // default keeps playing rather than the track falling silent.
    if (deviceId !== '') await element.setSinkId('').catch(() => undefined)
  }
}

/** Report what the machine can play through, and keep the choice applied. */
async function pushDevices(): Promise<void> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    const devices = all
      .filter((device) => device.kind === 'audiooutput')
      .map((device, index) => ({
        id: device.deviceId,
        // Labels are hidden until the page is allowed to see media devices;
        // a numbered fallback is still better than an empty row.
        label: device.label || `Устройство ${index + 1}`
      }))
    window.audioHost.event({ type: 'devices', devices })
    // A device list that changed may have taken our chosen output with it.
    if (wantedSink && !devices.some((device) => device.id === wantedSink)) await applySink('')
  } catch {
    // Enumeration is not vital; the default output still works.
  }
}

void pushDevices()
navigator.mediaDevices.addEventListener('devicechange', () => void pushDevices())
