import Hls from 'hls.js'

/**
 * The audio host. A hidden window whose only job is to own one media element,
 * so playback never depends on whether the UI window is shown, hidden to the
 * tray, or busy rendering a long list.
 */
const audio = new Audio()
audio.preload = 'auto'

let hls: Hls | null = null
let generation = 0

window.audioHost.onLoad(({ url, positionMs, volume, muted, autoplay }) => {
  const mine = ++generation
  
  if (hls) {
    hls.destroy()
    hls = null
  }
  
  audio.volume = volume
  audio.muted = muted
  if (positionMs > 0) {
    // currentTime only sticks once metadata is in; set it again when it lands.
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = positionMs / 1000 }, { once: true })
  }

  const doPlay = () => {
    if (!autoplay) return
    void audio.play().catch((error: unknown) => {
      if (mine !== generation) return
      window.audioHost.event({ type: 'error', message: describe(error) })
    })
  }

  if (url.includes('.m3u8') && Hls.isSupported()) {
    hls = new Hls()
    hls.loadSource(url)
    hls.attachMedia(audio)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (mine !== generation) return
      doPlay()
    })
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal && mine === generation) {
        window.audioHost.event({ type: 'error', message: `HLS error: ${data.details}` })
      }
    })
  } else {
    audio.src = url
    doPlay()
  }
})

window.audioHost.onControl((command) => {
  switch (command.type) {
    case 'play':
      void audio.play().catch((error: unknown) =>
        window.audioHost.event({ type: 'error', message: describe(error) })
      )
      return
    case 'pause':
      audio.pause()
      return
    case 'seek':
      if (Number.isFinite(audio.duration)) {
        audio.currentTime = Math.max(0, Math.min(audio.duration, command.positionMs / 1000))
      }
      return
    case 'setVolume':
      audio.volume = Math.max(0, Math.min(1, command.volume))
      return
    case 'setMuted':
      audio.muted = command.muted
      return
    case 'setSink':
      void applySink(command.deviceId)
      return
    case 'stop':
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      return
  }
})

const report = (type: 'progress' | 'playing' | 'paused' | 'ended' | 'ready' | 'stalled'): void =>
  window.audioHost.event({
    type,
    positionMs: Math.round(audio.currentTime * 1000),
    durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0
  })

audio.addEventListener('playing', () => report('playing'))
// Buffering: the element is "not paused" but the clock is not moving, so the
// UI must stop interpolating or the bar creeps forward on a silent track.
audio.addEventListener('waiting', () => report('stalled'))
audio.addEventListener('stalled', () => report('stalled'))
audio.addEventListener('pause', () => report('paused'))
audio.addEventListener('ended', () => report('ended'))
audio.addEventListener('canplay', () => report('ready'))
audio.addEventListener('durationchange', () => report('ready'))
audio.addEventListener('error', () => {
  window.audioHost.event({ type: 'error', message: mediaErrorText(audio.error?.code) })
})

// The UI interpolates between samples, so four a second is plenty.
setInterval(() => {
  if (!audio.paused) report('progress')
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
let wantedSink = ''

async function applySink(deviceId: string): Promise<void> {
  wantedSink = deviceId
  const element = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
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
