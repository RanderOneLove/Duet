import Hls from 'hls.js'
import type { AudioMeta, Loudness } from '../../preload/audio'

/**
 * The audio host. A hidden window whose only job is to own the media elements,
 * so playback never depends on whether the UI window is shown, hidden to the
 * tray, or busy rendering a long list.
 *
 * There are two slots, not one. Одного означало, что каждая смена трека
 * начинается с нуля: открыть ссылку, дождаться первых байтов и только потом
 * звук — намерено 120–190 мс тишины между треками. Запасной слот грузит то,
 * что очередь называет следующим, и смена трека подменяет слоты местами. Он же
 * нужен кроссфейду: два трека звучат разом, пока один затихает, а другой
 * нарастает.
 *
 * У каждого слота до двух элементов. Простой — как раньше: звук идёт из него
 * прямо в колонки. «Подключённый» отдаёт звук в Web Audio, где его можно
 * измерить и выровнять по громкости; ему нужен CORS, поэтому он заводится,
 * только когда выравнивание включено, а при отказе слот откатывается к
 * простому — лучше трек без выравнивания, чем тишина.
 */

interface Chain {
  /** Громкость этого слота: выравнивание, умноженное на кроссфейд. */
  gain: GainNode
  /** Взвешенный по K сигнал по каналам — для громкости. */
  weighted: AnalyserNode[]
  /** Сырой сигнал по каналам — для пика. */
  raw: AnalyserNode[]
}

interface Slot {
  /** Элемент, который сейчас в деле, — один из двух ниже. */
  el: HTMLAudioElement
  plain: HTMLAudioElement
  wired: HTMLAudioElement | null
  chain: Chain | null
  hls: Hls | null
  /** Что в этом слоте лежит, или null, когда он пуст. */
  url: string | null
  key: string
  /** Громкость трека: измеренная раньше или прямо сейчас. */
  loudness: Loudness | null
  /** Множитель выравнивания, к которому стремимся. */
  norm: number
  /** Присутствие в кроссфейде: 1 — звучит полностью, 0 — затих. */
  fade: number
  /** Этот трек уже откатился к простому элементу — второй раз не пробуем. */
  fellBack: boolean
  /** Замер громкости, пока он идёт. */
  meter: Meter | null
}

interface Meter {
  /** Средний квадрат взвешенного сигнала за окно ~85 мс, сумма по каналам. */
  windows: number[]
  peak: number
  reported: boolean
}

function makeSlot(): Slot {
  const plain = new Audio()
  plain.preload = 'auto'
  const slot: Slot = {
    el: plain,
    plain,
    wired: null,
    chain: null,
    hls: null,
    url: null,
    key: '',
    loudness: null,
    norm: 1,
    fade: 1,
    fellBack: false,
    meter: null
  }
  watch(slot, plain)
  return slot
}

let current: Slot
let spare: Slot
let generation = 0

/** Громкость принадлежит плееру, а не тому элементу, который сейчас звучит. */
let volume = 1
let muted = false
let wantedSink = ''

let normalize = false
let crossfadeMs = 0
/** Чего ждать от неизмеренного трека — подсказка из накопленных замеров. */
let typicalLufs = -9

// ---- Web Audio ----

let ctx: AudioContext | null = null
let master: GainNode | null = null

function audioContext(): AudioContext {
  if (ctx) return ctx
  ctx = new AudioContext({ latencyHint: 'playback' })
  master = ctx.createGain()
  master.connect(ctx.destination)
  applyMaster()
  if (wantedSink) void setContextSink(wantedSink)
  return ctx
}

/** Подключённый элемент слота, заведённый при первой надобности. */
function wiredOf(slot: Slot): HTMLAudioElement {
  if (slot.wired) return slot.wired
  const context = audioContext()
  const el = new Audio()
  el.preload = 'auto'
  // Без этого Chromium отдаёт в граф тишину: звук с чужого сервера «заражён».
  // Заголовок CORS для этого окна добавляет главный процесс.
  el.crossOrigin = 'anonymous'

  const source = context.createMediaElementSource(el)
  const gain = context.createGain()
  source.connect(gain)
  gain.connect(master!)

  // Взвешивание K из BS.1770: полка на верхах и срез самого низа.
  const shelf = context.createBiquadFilter()
  shelf.type = 'highshelf'
  shelf.frequency.value = 1681
  shelf.gain.value = 4
  const highpass = context.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 38
  // У Web Audio добротность среза — в децибелах: −6 дБ это Q 0,5 из стандарта.
  // С «0.5» срез звенел бы подъёмом на полтора децибела около 50 Гц.
  highpass.Q.value = -6.02
  source.connect(shelf)
  shelf.connect(highpass)

  const split = (input: AudioNode): AnalyserNode[] => {
    const splitter = context.createChannelSplitter(2)
    input.connect(splitter)
    return [0, 1].map((channel) => {
      const analyser = context.createAnalyser()
      analyser.fftSize = 4096
      splitter.connect(analyser, channel)
      return analyser
    })
  }

  slot.wired = el
  slot.chain = { gain, weighted: split(highpass), raw: split(source) }
  watch(slot, el)
  return el
}

// ---- уровни ----

/** Равная мощность: на середине кроссфейда оба трека по −3 дБ, а не по −6. */
const curve = (fade: number): number => Math.sin((Math.max(0, Math.min(1, fade)) * Math.PI) / 2)

function applyMaster(): void {
  if (!master || !ctx) return
  master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.015)
}

/**
 * Свести всё, что влияет на громкость слота, в одно число.
 *
 * Подключённый элемент играет на полную, а громкость плеера стоит на общем
 * выходе графа — иначе замер видел бы ползунок, а не запись. Простой элемент
 * несёт всё сам; выровнять его он может только вниз — громче единицы элемент
 * не умеет.
 */
function applyLevel(slot: Slot, smooth = 0.015): void {
  if (slot.chain && slot.el === slot.wired) {
    slot.el.volume = 1
    slot.el.muted = false
    const norm = normalize ? slot.norm : 1
    slot.chain.gain.gain.setTargetAtTime(norm * curve(slot.fade), ctx!.currentTime, smooth)
    return
  }
  const norm = normalize ? Math.min(1, slot.norm) : 1
  slot.el.volume = Math.max(0, Math.min(1, volume * norm * curve(slot.fade)))
  slot.el.muted = muted
}

// ---- выравнивание ----

/** Цель — как у «нормальной» громкости Spotify и YouTube. */
const TARGET_LUFS = -14
const MAX_BOOST_DB = 6
const MAX_CUT_DB = -18

function gainFor(loudness: Loudness): number {
  // Пик сэмплов не должен подняться выше −1 дБFS: без лимитера это и есть
  // граница, после которой тихий трек начнёт хрипеть.
  const headroom = -20 * Math.log10(Math.max(loudness.peak, 1e-4)) - 1
  const db = Math.max(MAX_CUT_DB, Math.min(TARGET_LUFS - loudness.lufs, headroom, MAX_BOOST_DB))
  return 10 ** (db / 20)
}

/** Известная громкость — или догадка по обычной, пока трек не измерен. */
function setLoudness(slot: Slot, loudness: Loudness | null): void {
  slot.loudness = loudness
  slot.norm = gainFor(loudness ?? { lufs: typicalLufs, peak: 1 })
}

const lufsOf = (meanSquare: number): number => -0.691 + 10 * Math.log10(meanSquare)

/**
 * Интегральная громкость по EBU R128: блоки по 400 мс, абсолютный порог −70,
 * затем относительный на 10 LU ниже среднего — тишина и затухания не тянут
 * оценку вниз.
 */
function integrated(windows: number[]): number | null {
  const blocks: number[] = []
  for (let i = 0; i + 4 <= windows.length; i += 1) {
    blocks.push((windows[i] + windows[i + 1] + windows[i + 2] + windows[i + 3]) / 4)
  }
  const loud = blocks.filter((block) => block > 0 && lufsOf(block) > -70)
  if (loud.length === 0) return null
  const gate = lufsOf(loud.reduce((sum, block) => sum + block, 0) / loud.length) - 10
  const kept = loud.filter((block) => lufsOf(block) > gate)
  return lufsOf(kept.reduce((sum, block) => sum + block, 0) / kept.length)
}

/** Первая оценка — через 6 секунд, уточнения — до 30, потом трек измерен. */
const METER_FIRST = 60
const METER_DONE = 300
const METER_STEP = 20

const scratch = new Float32Array(4096)

function sampleMeter(): void {
  const slot = current
  if (!normalize || !slot.chain || slot.el !== slot.wired || slot.el.paused) return
  if (slot.loudness || !slot.meter || slot.meter.reported) return

  const meter = slot.meter
  let energy = 0
  for (const analyser of slot.chain.weighted) {
    analyser.getFloatTimeDomainData(scratch)
    let sum = 0
    for (let i = 0; i < scratch.length; i += 1) sum += scratch[i] * scratch[i]
    energy += sum / scratch.length
  }
  for (const analyser of slot.chain.raw) {
    analyser.getFloatTimeDomainData(scratch)
    for (let i = 0; i < scratch.length; i += 1) {
      const value = Math.abs(scratch[i])
      if (value > meter.peak) meter.peak = value
    }
  }
  meter.windows.push(energy)

  const count = meter.windows.length
  if (count < METER_FIRST || (count - METER_FIRST) % METER_STEP !== 0) return
  const lufs = integrated(meter.windows)
  if (lufs === null) return
  const measured = { lufs, peak: Math.max(meter.peak, 0.05) }
  // Подстраиваемся медленно: на первом прослушивании громкость доезжает за
  // пару секунд, а не прыгает посреди куплета.
  slot.norm = gainFor(measured)
  applyLevel(slot, 1.2)

  if (count >= METER_DONE) {
    meter.reported = true
    slot.loudness = measured
    window.audioHost.event({ type: 'loudness', key: slot.key, loudness: measured })
  }
}

/**
 * Замер, оборванный раньше времени, — переключили трек — тоже чего-то стоит,
 * если набралось хотя бы 15 секунд звука.
 */
function flushMeter(slot: Slot): void {
  const meter = slot.meter
  slot.meter = null
  if (!meter || meter.reported || slot.loudness || meter.windows.length < 150 || !slot.key) return
  const lufs = integrated(meter.windows)
  if (lufs === null) return
  window.audioHost.event({ type: 'loudness', key: slot.key, loudness: { lufs, peak: Math.max(meter.peak, 0.05) } })
}

// ---- кроссфейд ----

interface Fade {
  from: Slot
  to: Slot
  startedAt: number
  ms: number
}

let fading: Fade | null = null
/** Новый трек уже запущен, но ещё не зазвучал — затухание ждёт его. */
let pendingFade: { from: Slot; to: Slot } | null = null
/** Подготовка следующего трека, пока слот занят затихающим. */
let deferredPreload: { url: string; key: string; loudness: Loudness | null } | null = null
let nearEndSent = false
let fadeTimer: number | null = null

/** Новый трек зазвучал — пора уводить старый. */
function beginPendingFade(): void {
  if (!pendingFade) return
  const { from, to } = pendingFade
  pendingFade = null
  startFade(from, to)
}

function startFade(from: Slot, to: Slot): void {
  const left = Number.isFinite(from.el.duration) ? (from.el.duration - from.el.currentTime) * 1000 : crossfadeMs
  const ms = Math.max(300, Math.min(crossfadeMs, left))
  fading = { from, to, startedAt: performance.now(), ms }
  if (fadeTimer === null) fadeTimer = window.setInterval(stepFade, 40)
}

function stepFade(): void {
  if (!fading) return
  const progress = Math.min(1, (performance.now() - fading.startedAt) / fading.ms)
  fading.to.fade = progress
  fading.from.fade = 1 - progress
  applyLevel(fading.to)
  applyLevel(fading.from)
  if (progress >= 1) finishFade()
}

/** Довести кроссфейд до конца сразу: затихающий трек отпустить. */
function finishFade(): void {
  if (fadeTimer !== null) {
    window.clearInterval(fadeTimer)
    fadeTimer = null
  }
  const fade = fading ?? pendingFade
  fading = null
  pendingFade = null
  if (!fade) return
  fade.to.fade = 1
  applyLevel(fade.to)
  fade.from.el.pause()
  release(fade.from)
  fade.from.fade = 1
  if (deferredPreload) {
    const wanted = deferredPreload
    deferredPreload = null
    preload(wanted.url, wanted.key, wanted.loudness)
  }
}

// ---- загрузка ----

window.audioHost.onLoad((payload) => {
  const mine = ++generation
  volume = payload.volume
  muted = payload.muted
  typicalLufs = payload.typicalLufs
  applyMaster()
  describeTrack(payload.meta)
  nearEndSent = false

  const outgoing = current
  const canFade =
    payload.crossfade === true &&
    crossfadeMs > 0 &&
    !fading &&
    !pendingFade &&
    !outgoing.el.paused &&
    !outgoing.el.ended &&
    outgoing.url !== null

  if (canFade) {
    // Новый трек звучит вторым слотом; прежний затихнет, когда тот зазвучит.
    const incoming = spare
    if (incoming.url !== payload.url) load(incoming, payload.url, mine)
    current = incoming
    spare = outgoing
    flushMeter(outgoing)
    prepare(incoming, payload.key, payload.loudness)
    incoming.fade = 0
    applyLevel(incoming)
    if (wantedSink) void setSink(incoming, wantedSink)
    startAt(incoming, payload.positionMs)
    // Затухание начнётся, когда новый трек зазвучит (см. watch): уводить
    // старый раньше — значит оставить паузу, пока новый буферизуется.
    pendingFade = { from: outgoing, to: incoming }
    play(incoming, mine)
    return
  }

  finishFade()
  flushMeter(current)

  // Уже наготове: подменяем слоты вместо того, чтобы грузить заново.
  if (spare.url === payload.url) {
    const old = current
    current = spare
    spare = old
    old.el.pause()
    release(old)
  } else {
    release(spare)
    load(current, payload.url, mine)
  }
  prepare(current, payload.key, payload.loudness)
  current.fade = 1
  applyLevel(current)
  if (wantedSink) void setSink(current, wantedSink)
  startAt(current, payload.positionMs)
  if (payload.autoplay) play(current, mine)
})

/** Трек в слоте стал звучащим: его громкость и замер. */
function prepare(slot: Slot, key: string, loudness: Loudness | null): void {
  const known = loudness ?? (slot.key === key ? slot.loudness : null)
  setLoudness(slot, known)
  slot.key = key
  slot.meter = known ? null : { windows: [], peak: 0, reported: false }
}

window.audioHost.onControl((command) => {
  switch (command.type) {
    case 'play':
      play(current, generation)
      return
    case 'pause':
      finishFade()
      wantsPlay = false
      current.el.pause()
      return
    case 'seek':
      finishFade()
      if (Number.isFinite(current.el.duration)) {
        current.el.currentTime = Math.max(0, Math.min(current.el.duration, command.positionMs / 1000))
      }
      return
    case 'setVolume':
      volume = Math.max(0, Math.min(1, command.volume))
      applyMaster()
      applyAll()
      return
    case 'setMuted':
      muted = command.muted
      applyMaster()
      applyAll()
      return
    case 'setSink':
      void applySink(command.deviceId)
      return
    case 'preload':
      // Запасной слот сейчас занят затихающим треком — подготовим потом.
      if (fading || pendingFade) deferredPreload = command
      else preload(command.url, command.key, command.loudness)
      return
    case 'setProcessing':
      normalize = command.normalize
      crossfadeMs = Math.max(0, command.crossfadeMs)
      applyAll()
      return
    case 'stop':
      finishFade()
      wantsPlay = false
      current.el.pause()
      flushMeter(current)
      release(current)
      release(spare)
      clearSession()
      return
  }
})

function applyAll(): void {
  applyLevel(current)
  applyLevel(spare)
}

/**
 * Отдать слоту источник. Шифрованный HLS разбирает hls.js, остальное — сам.
 *
 * Элемент выбирается здесь же: при выравнивании — подключённый, иначе —
 * простой. Решение принимается на каждый трек, поэтому выключатель в
 * настройках действует со следующей песни, а не после перезапуска.
 */
function load(slot: Slot, url: string, mine: number, forcePlain = false): void {
  release(slot)
  slot.url = url
  slot.fellBack = forcePlain
  slot.el = normalize && !forcePlain ? wiredOf(slot) : slot.plain
  slot.fade = 1

  if (url.includes('.m3u8') && Hls.isSupported()) {
    const hls = new Hls()
    slot.hls = hls
    hls.loadSource(url)
    hls.attachMedia(slot.el)
    hls.on(Hls.Events.ERROR, (_, data) => {
      // О беде сообщает только тот слот, который сейчас слышно: запасной
      // молчит — его ссылка ещё может и не понадобиться.
      if (data.fatal && slot === current && mine === generation) {
        window.audioHost.event({ type: 'error', message: `HLS error: ${data.details}` })
      }
    })
    return
  }

  slot.el.src = url
  slot.el.load()
}

/** Начать буферизовать следующий трек, не трогая то, что играет. */
function preload(url: string, key: string, loudness: Loudness | null): void {
  if (spare.url === url || current.url === url) return
  load(spare, url, generation)
  spare.el.pause()
  spare.key = key
  setLoudness(spare, loudness)
  // Запасной всегда нем: громкость ему выставляется при подмене.
  spare.el.volume = 0
  spare.el.muted = true
  if (spare.chain) spare.chain.gain.gain.value = 0
}

function release(slot: Slot): void {
  if (slot.hls) {
    slot.hls.destroy()
    slot.hls = null
  }
  for (const el of [slot.plain, slot.wired]) {
    if (!el || !el.getAttribute('src')) continue
    el.removeAttribute('src')
    el.load()
  }
  slot.url = null
  slot.meter = null
}

function startAt(slot: Slot, positionMs: number): void {
  if (positionMs <= 0) return
  const seconds = positionMs / 1000
  if (slot.el.readyState > 0) {
    slot.el.currentTime = seconds
    return
  }
  // currentTime only sticks once metadata is in; set it again when it lands.
  const el = slot.el
  el.addEventListener(
    'loadedmetadata',
    () => {
      el.currentTime = seconds
    },
    { once: true }
  )
}

/** Хочет ли плеер, чтобы звучало: откат элемента не должен включать музыку сам. */
let wantsPlay = false

function play(slot: Slot, mine: number): void {
  if (slot === current) wantsPlay = true
  if (ctx && ctx.state === 'suspended') void ctx.resume()
  const el = slot.el
  void el.play().catch((error: unknown) => {
    if (mine !== generation || el !== slot.el) return
    // Прерванная подменой элемента попытка — не ошибка.
    if (error instanceof DOMException && error.name === 'AbortError') return
    window.audioHost.event({ type: 'error', message: describe(error) })
  })
}

/**
 * Подключённый элемент не смог открыть ссылку. Чаще всего это CORS — сервер
 * не разрешил читать звук, — а это не повод молчать: тот же трек открывается
 * простым элементом, без выравнивания. Если не откроется и так, значит дело в
 * ссылке, и об ошибке узнает плеер.
 */
function fallBack(slot: Slot): boolean {
  if (slot.el !== slot.wired || slot.fellBack || !slot.url || slot.hls) return false
  const url = slot.url
  const at = slot.el.currentTime
  console.warn('[audio] подключённый элемент не открыл ссылку, играем без выравнивания')
  load(slot, url, generation, true)
  applyLevel(slot)
  if (wantedSink) void setSink(slot, wantedSink)
  if (at > 0) startAt(slot, at * 1000)
  if (slot === current && wantsPlay) play(slot, generation)
  if (slot === spare) {
    slot.el.volume = 0
    slot.el.muted = true
  }
  return true
}

// ---- отчёт о том, что слышно ----

const report = (type: 'progress' | 'playing' | 'paused' | 'ended' | 'ready' | 'stalled'): void => {
  const el = current.el
  const event = {
    type,
    positionMs: Math.round(el.currentTime * 1000),
    durationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0
  }
  window.audioHost.event(event)
  if (type !== 'progress') syncSession()
}

/**
 * События вешаются на оба слота, но наружу уходят только от звучащего — и
 * только от того его элемента, что сейчас в деле: запасной, пока грузится,
 * тоже шлёт 'canplay' и 'durationchange', и без этой проверки плеер узнавал
 * бы длительность следующего трека вместо текущего.
 */
function watch(slot: Slot, el: HTMLAudioElement): void {
  const mineOnly =
    (run: () => void) =>
    (): void => {
      if (slot === current && el === slot.el) run()
    }
  el.addEventListener(
    'playing',
    mineOnly(() => {
      if (pendingFade?.to === slot) beginPendingFade()
      report('playing')
    })
  )
  // Buffering: the element is "not paused" but the clock is not moving, so the
  // UI must stop interpolating or the bar creeps forward on a silent track.
  el.addEventListener('waiting', mineOnly(() => report('stalled')))
  el.addEventListener('stalled', mineOnly(() => report('stalled')))
  el.addEventListener('pause', mineOnly(() => report('paused')))
  el.addEventListener('ended', mineOnly(() => report('ended')))
  el.addEventListener('canplay', mineOnly(() => report('ready')))
  el.addEventListener('durationchange', mineOnly(() => report('ready')))
  el.addEventListener('seeked', mineOnly(syncSession))
  el.addEventListener('error', () => {
    if (el !== slot.el || !slot.url) return
    if (fallBack(slot)) return
    if (slot !== current) return
    window.audioHost.event({ type: 'error', message: mediaErrorText(el.error?.code) })
  })
}

current = makeSlot()
spare = makeSlot()

// The UI interpolates between samples, so four a second is plenty.
setInterval(() => {
  if (current.el.paused) return
  report('progress')
  watchNearEnd()
}, 250)

// Замер громкости — чаще: окна по ~85 мс должны идти друг за другом.
setInterval(sampleMeter, 100)

/**
 * Сказать плееру, что пора переходить: до конца осталось столько, сколько
 * длится кроссфейд. Решает он — при «повторять трек» или в конце очереди он
 * промолчит, и трек доиграет как обычно.
 */
function watchNearEnd(): void {
  if (crossfadeMs <= 0 || fading) return
  const el = current.el
  if (!Number.isFinite(el.duration)) return
  const window_ = crossfadeMs / 1000
  // Короткий трек целиком ушёл бы в переход.
  if (el.duration < window_ * 3) return
  const left = el.duration - el.currentTime
  // Запас в четверть секунды — на дорогу до плеера и обратно.
  if (left > window_ + 1.25) nearEndSent = false
  if (nearEndSent || left > window_ + 0.25) return
  nearEndSent = true
  window.audioHost.event({ type: 'nearEnd', positionMs: Math.round(el.currentTime * 1000) })
}

// ---- плашка Windows ----

/**
 * Что играет — для системы: плашка громкости Windows, экран блокировки,
 * кнопки гарнитуры. Без этого там было бы «audio host» без обложки, а кнопки
 * «вперёд» и «назад» не делали бы ничего.
 */
const session = 'mediaSession' in navigator ? navigator.mediaSession : null

function describeTrack(meta: AudioMeta): void {
  if (!session) return
  session.metadata = new MediaMetadata({
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    artwork: meta.artwork ? [{ src: meta.artwork, sizes: '400x400' }] : []
  })
}

function clearSession(): void {
  if (!session) return
  session.metadata = null
  session.playbackState = 'none'
}

function syncSession(): void {
  if (!session) return
  const el = current.el
  session.playbackState = el.paused ? 'paused' : 'playing'
  if (!Number.isFinite(el.duration) || el.duration <= 0) return
  try {
    session.setPositionState({
      duration: el.duration,
      position: Math.min(el.currentTime, el.duration),
      playbackRate: 1
    })
  } catch {
    // Позиция на миг вышла за длительность — следующий отчёт поправит.
  }
}

if (session) {
  const on = (action: MediaSessionAction, handler: MediaSessionActionHandler): void => {
    try {
      session.setActionHandler(action, handler)
    } catch {
      // Эта версия Chromium такого действия не знает.
    }
  }
  on('play', () => window.audioHost.action({ type: 'play' }))
  on('pause', () => window.audioHost.action({ type: 'pause' }))
  on('stop', () => window.audioHost.action({ type: 'pause' }))
  on('previoustrack', () => window.audioHost.action({ type: 'prev' }))
  on('nexttrack', () => window.audioHost.action({ type: 'next' }))
  on('seekto', (details) => {
    if (details.seekTime === undefined) return
    window.audioHost.action({ type: 'seek', positionMs: Math.round(details.seekTime * 1000) })
  })
}

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
 * Подключённые элементы звучат через граф, поэтому выход меняется и у него.
 */
async function applySink(deviceId: string): Promise<void> {
  wantedSink = deviceId
  // Оба слота: подмена не должна возвращать звук в системное устройство.
  await Promise.all([setSink(current, deviceId), setSink(spare, deviceId), setContextSink(deviceId)])
}

async function setSink(slot: Slot, deviceId: string): Promise<void> {
  const element = slot.plain as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (!element.setSinkId) return
  try {
    await element.setSinkId(deviceId)
  } catch {
    // The device was unplugged between listing and selecting; the system
    // default keeps playing rather than the track falling silent.
    if (deviceId !== '') await element.setSinkId('').catch(() => undefined)
  }
}

async function setContextSink(deviceId: string): Promise<void> {
  const context = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
  if (!context?.setSinkId) return
  try {
    await context.setSinkId(deviceId)
  } catch {
    if (deviceId !== '') await context.setSinkId('').catch(() => undefined)
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
