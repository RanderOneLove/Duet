import { app, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import type { Track } from '@shared/domain'
import { IPC } from '@shared/ipc'
import type { AudioEvent } from '../preload/audio'
import { command, onPlayerChanged } from './player/engine'
import { getSettings, setSettings } from './state/settings'
import { ACCENTS, DEFAULT_HOME_BLOCKS } from '@shared/types'
import { discordStats } from './discord'
import { getPlayer } from './player/engine'
import { albumTracks, artistTracks, home, likedTracks, playlists, search } from './sources/registry'
import { getMainWindow } from './windows/mainWindow'
import { createMiniPlayer, hideMiniPlayer, showMiniPlayer } from './windows/miniPlayer'

/**
 * Замер производительности — то, чем проверяется «стало быстрее».
 *
 * Обычный запуск сюда не заходит: всё включается переменной DUET_PERF, в
 * которой лежит путь для отчёта. Без неё `mark()` — одно сравнение с null, а
 * сценарий не запускается вовсе.
 *
 * Запускается через `npm run perf`: тот копирует профиль (без кэшей), чтобы
 * замер шёл на настоящей библиотеке и настоящих сессиях, но ничего не портил
 * в рабочем профиле — сценарий крутит громкость, играет треки и ставит лайки
 * там, где этого не жалко.
 */

const REPORT = process.env['DUET_PERF'] ?? null

/** Длина окна наблюдения за окном и главным процессом. */
const SPAN_MS = 5000

export function perfEnabled(): boolean {
  return REPORT !== null
}

/**
 * Разведка вместо замера: тот же профиль и то же приложение, но вместо
 * сценария — один вопрос к данным. Нужна там, где догадка о чужом API стоит
 * дороже, чем прогон: например, чем лайкнутый трек VK отличается от того же
 * трека из волны.
 */
const PROBE = process.env['DUET_PROBE'] ?? null

export async function runPerf(): Promise<void> {
  if (PROBE === 'boxes') return runBoxProbe()
  if (PROBE === 'wave') return runWaveProbe()
  if (PROBE === 'dock') return runDockProbe()
  if (PROBE === 'close') return runCloseProbe()
  if (PROBE === 'readme') return runReadmeShots()
  if (PROBE === 'anim') return runAnimProbe()
  if (PROBE === 'mini') return runMiniProbe()
  if (PROBE === 'shots') return runShots()
  if (PROBE === 'look') return runLookProbe()
  if (PROBE === 'vkdislike') return runVkDislikeProbe()
  if (PROBE === 'vkban') return runVkBanProbe()
  if (PROBE === 'together') return runTogetherProbe()
  if (PROBE === 'about') return runAboutProbe()
  if (PROBE === 'seg') return runSegProbe()
  if (PROBE) return runProbe()
  return runScenario()
}

/**
 * Снимки экрана по обеим темам.
 *
 * Оформление проверяется глазами, иначе это не проверка, а надежда. Прогон
 * проходит по экранам в светлой теме, потом в тёмной, и складывает картинки
 * рядом — так видно и то, что сломалось только в одной из них.
 */
/**
 * Где на самом деле лежат элементы.
 *
 * Жалобы на «съезжает» и «вылазит» — про геометрию, и спорить о ней по коду
 * бессмысленно: браузер знает точно. Проба открывает нужные экраны и снимает
 * рамки элементов, чтобы видно было, кто кого выталкивает.
 */
async function runBoxProbe(): Promise<void> {
  const { writeFileSync } = await import('node:fs')
  const report: Record<string, unknown> = { probe: 'boxes' }

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)
    const window = getMainWindow()
    if (!window) throw new Error('нет окна оболочки')
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
    window.setSize(1280, 800)
    setSettings({ sidebarCollapsed: false })
    await wait(1200)

    const run = async <T>(code: string): Promise<T> =>
      (await window.webContents.executeJavaScript(code)) as T

    const boxes = (selectors: string[]): string =>
      `(() => {
        const out = {}
        out['окно'] = innerWidth + 'x' + innerHeight
        for (const sel of ${JSON.stringify(selectors)}) {
          const n = document.querySelector(sel)
          if (!n) { out[sel] = 'нет'; continue }
          const b = n.getBoundingClientRect()
          out[sel] = Math.round(b.left) + ',' + Math.round(b.top) + ' ' +
                     Math.round(b.width) + 'x' + Math.round(b.height)
        }
        return out
      })()`

    // ---- плеер «во всё окно» ----
    const queue = (await likedTracks()).filter((track) => track.available).slice(0, 10)
    if (queue.length > 0) {
      void command({ type: 'playQueue', tracks: queue, startIndex: 0 })
      await wait(2500)
      void command({ type: 'pause' })
    }
    // Окно как у человека на большом экране: жалоба была именно оттуда.
    window.setSize(1700, 1000)
    setSettings({ playerLayout: 'ambient' })
    await wait(900)
    await run(`(() => { const b = document.querySelector('.dock__track'); if (b) b.click(); return true })()`)
    await wait(2500)
    report.ambient = await run<Record<string, string>>(
      boxes(['.ambient', '.ambient__top', '.ambient__stage', '.ambient__now', '.ambient__dock', '.lyrics'])
    )
    // Долистываем текст до конца: жалоба была про то, что от него всё едет.
    await run(`(() => {
      const box = document.querySelector('.ambient__stage')
      if (box) box.scrollTop = box.scrollHeight
      return true
    })()`)
    await wait(700)
    report.ambientScrolled = await run<Record<string, string>>(
      boxes(['.ambient', '.ambient__top', '.ambient__stage', '.ambient__dock'])
    )
    {
      const image = await window.webContents.capturePage()
      const { writeFileSync: dump } = await import('node:fs')
      const { join: at } = await import('node:path')
      dump(at(process.env['DUET_SHOTS'] ?? '.', 'ambient-big.png'), image.toPNG())
    }
    await run(`(() => { const b = document.querySelector('.ambient__top button'); if (b) b.click(); return true })()`)
    await wait(600)
    setSettings({ playerLayout: 'split' })

    // ---- карточки выбора вида главной ----
    await run(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => (x.textContent ?? '').includes('Настройки') || (x.title ?? '').includes('Настройки')
      )
      if (b) b.click(); return true
    })()`)
    await wait(1400)
    report.layoutCards = await run<Record<string, string>>(
      boxes(['.layouts', '.layoutcard', '.layoutcard__stage', '.layoutcard__hero', '.layoutcard__line'])
    )
    report.stageStyle = await run<Record<string, string>>(`(() => {
      const n = document.querySelector('.layoutcard__stage')
      if (!n) return { нет: 'да' }
      const s = getComputedStyle(n)
      return { display: s.display, direction: s.flexDirection, align: s.alignItems, height: s.height }
    })()`)

    // ---- панель плеера в узком окне ----
    window.setSize(980, 720)
    await wait(900)
    report.dockNarrow = await run<Record<string, unknown>>(`(() => {
      const dock = document.querySelector('.dock')
      const right = document.querySelector('.dock__right')
      const b = dock.getBoundingClientRect()
      const r = right.getBoundingClientRect()
      return {
        окно: innerWidth + 'x' + innerHeight,
        плита: Math.round(b.width),
        правыйБлок: Math.round(r.width),
        вылезает: Math.round(r.right - b.right),
        кнопки: [...right.children].map((c) => Math.round(c.getBoundingClientRect().width))
      }
    })()`)

    // ---- блоки главной ----
    window.setSize(1280, 800)
    await wait(600)
    await run(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => (x.textContent ?? '').includes('Главная') || (x.title ?? '').includes('Главная')
      )
      if (b) b.click(); return true
    })()`)
    await wait(1600)
    // Проверяем не то, что записано, а то, что нарисовано: включаем блок,
    // смотрим, появился ли он, выключаем — и смотрим, пропал ли.
    const titles = async (): Promise<string[]> =>
      run<string[]>("[...document.querySelectorAll('.home__title')].map((n) => n.textContent)")

    const blocks = getSettings().homeBlocks
    setSettings({
      homeBlocks: blocks.map((b) => (b.id === 'downloads' ? { ...b, shown: true } : b))
    })
    await wait(1200)
    const withIt = await titles()

    setSettings({
      homeBlocks: getSettings().homeBlocks.map((b) =>
        b.id === 'downloads' ? { ...b, shown: false } : b
      )
    })
    await wait(1200)
    const withoutIt = await titles()

    report.homeBlocks = {
      порядок: getSettings().homeBlocks,
      приВключённом: withIt,
      приВыключенном: withoutIt,
      исчезает: withIt.includes('Скачанное') && !withoutIt.includes('Скачанное')
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Повторяются ли треки в волне — и чем сервисы отвечают на «не нравится».
 *
 * Жалоба была про повторы у Яндекса. Проверяется тем же способом, каким
 * проверялось всё остальное: берётся несколько порций подряд, ровно так, как
 * их берёт плеер, и считается, сколько треков встретилось дважды. Заодно
 * перебираются методы, которыми можно сказать сервису «не нравится», — гадать
 * о чужом API дороже, чем спросить.
 */
async function runWaveProbe(): Promise<void> {
  const { writeFileSync } = await import('node:fs')
  const report: Record<string, unknown> = { probe: 'wave' }

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)

    // ---- повторы в волне ----
    const { YandexSource } = await import('./sources/yandex/source')
    const source = new YandexSource() as unknown as {
      restore: () => Promise<unknown>
      wave: (after?: string) => Promise<Track[]>
      waveFeedback: (event: string, track?: Track, played?: number) => Promise<void>
      api?: unknown
    }
    await source.restore()

    const batches: string[][] = []
    const seen = new Map<string, number>()
    let cursor: string | undefined

    for (let i = 0; i < 5; i += 1) {
      const tracks = await source.wave(cursor)
      batches.push(tracks.map((track) => `${track.title} — ${track.artists.join(', ')}`))
      for (const track of tracks) seen.set(track.nativeId, (seen.get(track.nativeId) ?? 0) + 1)
      cursor = tracks[tracks.length - 1]?.nativeId

      // Плеер сообщает станции, что треки сыграны, — без этого она стоит на
      // месте. Проба обязана вести себя так же, иначе она мерит не то.
      await source.waveFeedback('radioStarted')
      for (const track of tracks) {
        await source.waveFeedback('trackStarted', track)
        await source.waveFeedback('trackFinished', track, Math.round(track.durationMs / 1000))
      }
      await wait(400)
    }

    const repeats = [...seen.entries()].filter(([, count]) => count > 1)
    report.wave = {
      порций: batches.length,
      вПорции: batches.map((batch) => batch.length),
      всегоТреков: [...seen.values()].reduce((a, b) => a + b, 0),
      различных: seen.size,
      повторившихся: repeats.length,
      примерыПовторов: repeats.slice(0, 5).map(([id, count]) => `${id} ×${count}`),
      перваяПорция: batches[0]?.slice(0, 4),
      втораяПорция: batches[1]?.slice(0, 4)
    }

    // ---- дизлайк целиком, но без вреда ----
    //
    // Проверяется на треке, который уже лежит в нелюбимых: повторный дизлайк
    // ничего не меняет, а путь проходит весь — от команды плеера до сервиса.
    try {
      const uid = (source as unknown as { uid: string }).uid
      const apiGet = (source as unknown as { api: { get: <T>(p: string) => Promise<T> } }).api
      const before = await apiGet.get<Record<string, unknown>>(`/users/${uid}/dislikes/tracks`)
      const list = ((before as { library?: { tracks?: { id?: string }[] } })?.library?.tracks ?? [])
      const first = list[0]?.id
      if (first) {
        await (source as unknown as { api: { dislike: (u: string, t: string) => Promise<void> } }).api.dislike(
          uid,
          String(first)
        )
        const after = await apiGet.get<Record<string, unknown>>(`/users/${uid}/dislikes/tracks`)
        const listAfter = ((after as { library?: { tracks?: unknown[] } })?.library?.tracks ?? [])
        report.dislikeCall = {
          трек: String(first),
          былоВСписке: list.length,
          сталоВСписке: listAfter.length,
          безОшибки: true
        }
      } else {
        report.dislikeCall = 'список нелюбимых пуст — проверять не на чем'
      }
    } catch (error) {
      report.dislikeCall = `ошибка: ${error instanceof Error ? error.message : String(error)}`
    }

    // ---- чем сказать «не нравится» ----
    const liked = await likedTracks()

    // ---- есть ли у текста песни тайминги ----
    //
    // В макете 1f строка подсвечивается по ходу песни. Подсветить без таймингов
    // честно нельзя, поэтому сначала вопрос: отдаёт ли сервис размеченный текст.
    try {
      const uid = (source as unknown as { uid: string }).uid
      void uid
      const withLyrics = liked.find((track) => track.service === 'yandex')
      if (withLyrics) {
        const { createHmac } = await import('node:crypto')
        const stamp = Math.floor(Date.now() / 1000)
        const sign = createHmac('sha256', 'p93jhgh689SBReK6ghtw62')
          .update(`${withLyrics.nativeId}${stamp}`)
          .digest('base64')
        const probeFormat = async (format: string): Promise<unknown> => {
          const got = await (
            source as unknown as { api: { get: <T>(p: string) => Promise<T> } }
          ).api.get<Record<string, unknown>>(
            `/tracks/${withLyrics.nativeId}/lyrics?format=${format}&timeStamp=${stamp}&sign=${encodeURIComponent(sign)}`
          )
          const url = (got as { downloadUrl?: string })?.downloadUrl
          if (!url) return 'без ссылки'
          const text = await (await fetch(url)).text()
          return { первыеСтроки: text.split(String.fromCharCode(10)).slice(0, 4), длина: text.length }
        }
        report.lyricsFormats = {
          трек: withLyrics.title,
          TEXT: await probeFormat('TEXT').catch((e) => `ошибка: ${String(e)}`),
          LRC: await probeFormat('LRC').catch((e) => `ошибка: ${String(e)}`)
        }
      }
    } catch (error) {
      report.lyricsFormats = `ошибка: ${error instanceof Error ? error.message : String(error)}`
    }

    const yandexTrack = liked.find((track) => track.service === 'yandex')
    const api = (source as unknown as { api?: { post: (p: string, b: URLSearchParams) => Promise<unknown> } }).api
    const yandexTried: Record<string, unknown> = {}
    if (api && yandexTrack) {
      // Проверяем только то, что читает состояние: список дизлайков. Ставить
      // дизлайк на настоящем аккаунте проба не должна.
      try {
        const got = await (
          source as unknown as { api: { get: <T>(p: string) => Promise<T> } }
        ).api.get<Record<string, unknown>>(`/users/${(source as unknown as { uid: string }).uid}/dislikes/tracks`)
        const library = (got as { library?: { tracks?: unknown[] } })?.library
        yandexTried['dislikes/tracks'] = {
          отвечает: true,
          сейчасВСписке: Array.isArray(library?.tracks) ? library!.tracks!.length : null
        }
      } catch (error) {
        yandexTried['dislikes/tracks'] = `ошибка: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    report.yandexDislike = yandexTried

    // ---- VK: какие методы вообще есть ----
    try {
      const { VkSource } = await import('./sources/vk/source')
      const vk = new VkSource() as unknown as {
        restore: () => Promise<unknown>
        call: (method: string, params: URLSearchParams) => Promise<unknown>
      }
      await vk.restore()
      const vkTried: Record<string, unknown> = {}
      for (const method of ['audio.getDislikedAudios', 'audio.dislikeAudio', 'audio.addDislike']) {
        try {
          const data = await vk.call(method, new URLSearchParams({ count: '1' }))
          vkTried[method] = data === null ? 'метод отказал' : 'ответил'
        } catch (error) {
          vkTried[method] = `ошибка: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      report.vkDislike = vkTried
    } catch (error) {
      report.vkDislike = `ошибка: ${error instanceof Error ? error.message : String(error)}`
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Разъезжается ли ряд кнопок в панели плеера.
 *
 * Жалоба была про то, что от смены устройства вывода уезжают соседние кнопки
 * и громкость. Проверяется измерением: запоминается левый край ползунка
 * громкости, потом меняются подписи — устройство и пошедший таймер, — и край
 * смотрится снова. Сдвиг в пикселях и есть ответ.
 */
async function runDockProbe(): Promise<void> {
  const { writeFileSync } = await import('node:fs')
  const report: Record<string, unknown> = { probe: 'dock' }

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)
    const window = getMainWindow()
    if (!window) throw new Error('нет окна оболочки')
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
    window.setSize(1280, 800)
    await wait(1200)

    const run = async <T>(code: string): Promise<T> =>
      (await window.webContents.executeJavaScript(code)) as T

    const edge = async (): Promise<number> =>
      run<number>(
        "Math.round(document.querySelector('.dock__volume').getBoundingClientRect().left)"
      )

    // Исходно: системное устройство и таймер не заведён.
    void command({ type: 'setOutputDevice', deviceId: '' })
    void command({ type: 'setSleepTimer', minutes: null })
    await wait(800)
    report.before = await edge()
    report.labelsBefore = await run<string[]>(
      "[...document.querySelectorAll('.dock__right .gbtn--labelled')].map((b) => b.textContent)"
    )

    // Самое длинное имя устройства из тех, что есть, и запущенный таймер.
    const devices = getPlayer().outputDevices.filter((device) => device.id && device.id !== 'default')
    const longest = devices.sort((a, b) => b.label.length - a.label.length)[0]
    if (longest) void command({ type: 'setOutputDevice', deviceId: longest.id })
    void command({ type: 'setSleepTimer', minutes: 45 })
    await wait(1200)

    report.after = await edge()
    report.labelsAfter = await run<string[]>(
      "[...document.querySelectorAll('.dock__right .gbtn--labelled')].map((b) => b.textContent)"
    )
    report.shiftPx = (report.after as number) - (report.before as number)

    void command({ type: 'setSleepTimer', minutes: null })
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Почему не закрывается полноэкранный плеер.
 *
 * Проверяется не разметка, а то, что происходит на самом деле: открылся ли он,
 * есть ли кнопка, что лежит под её серединой по мнению самого браузера и
 * доходит ли до неё щелчок. Кнопка может быть на месте и при этом быть накрыта
 * чем-то прозрачным — по коду этого не видно.
 */
async function runCloseProbe(): Promise<void> {
  const { writeFileSync } = await import('node:fs')
  const report: Record<string, unknown> = { probe: 'close' }

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)
    const window = getMainWindow()
    if (!window) throw new Error('нет окна оболочки')
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
    window.setSize(1280, 800)
    await wait(1200)

    const run = async <T>(code: string): Promise<T> =>
      (await window.webContents.executeJavaScript(code)) as T

    // Что-нибудь должно играть, иначе открывать плеер не для чего.
    const queue = (await likedTracks()).filter((track) => track.available).slice(0, 10)
    if (queue.length > 0) {
      void command({ type: 'playQueue', tracks: queue, startIndex: 0 })
      await wait(2500)
      void command({ type: 'pause' })
      await wait(400)
    }

    report.openedBy = await run<string>(`(() => {
      const b = document.querySelector('.dock__track')
      if (!b) return 'нет .dock__track'
      b.click()
      return 'щёлкнули по плите'
    })()`)
    await wait(900)

    report.playerOpen = await run<boolean>("document.querySelector('.fullplayer') !== null")

    report.button = await run<Record<string, unknown>>(`(() => {
      const btn = document.querySelector('.fullplayer__header button')
      if (!btn) return { есть: false }
      const box = btn.getBoundingClientRect()
      const x = Math.round(box.left + box.width / 2)
      const y = Math.round(box.top + box.height / 2)
      const top = document.elementFromPoint(x, y)
      const style = getComputedStyle(btn)
      return {
        есть: true,
        размер: Math.round(box.width) + 'x' + Math.round(box.height),
        точка: x + ',' + y,
        подНей: top ? (top.className || top.tagName) : 'ничего',
        этоОнаИлиЕёПотомок: !!top && (btn === top || btn.contains(top)),
        видимость: style.visibility,
        события: style.pointerEvents,
        прозрачность: style.opacity,
        зона: style.getPropertyValue('-webkit-app-region') || '(нет)'
      }
    })()`)

    // Программный щелчок обходит систему и потому ничего не доказывает: он
    // сработает и там, где Windows забрала область себе под перетаскивание
    // окна. Поэтому координаты кнопки выкладываются наружу, а щёлкает по ним
    // настоящая мышь.
    const point = await run<{ x: number; y: number }>(`(() => {
      const btn = document.querySelector('.fullplayer__header button')
      const b = btn.getBoundingClientRect()
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
    })()`)
    const bounds = window.getContentBounds()
    const screenPoint = { x: bounds.x + point.x, y: bounds.y + point.y }
    report.screenPoint = screenPoint
    const { writeFileSync: dump } = await import('node:fs')
    dump((process.env['DUET_MINI_BOUNDS'] as string) ?? 'point.json', JSON.stringify(screenPoint))

    await wait(20_000)
    report.stillOpenAfterRealClick = await run<boolean>(
      "document.querySelector('.fullplayer') !== null"
    )
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Снимки для README.
 *
 * Отдельно от проверочных: тем нужна правда о состоянии, а этим — чтобы по ним
 * было понятно, что это за приложение. Поэтому здесь и подобранное окно, и
 * играющий трек с настоящей обложкой, и все четыре вида мини-плеера подряд.
 *
 * Недавние запросы из боковой панели вычищаются: README публичный, а история
 * поиска — личное.
 */
async function runReadmeShots(): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const out = process.env['DUET_SHOTS'] ?? '.'
  mkdirSync(out, { recursive: true })

  const report: Record<string, unknown> = { probe: 'readme', shots: [] as string[] }
  const shots = report.shots as string[]

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)
    const window = getMainWindow()
    if (!window) throw new Error('нет окна оболочки')

    window.webContents.setBackgroundThrottling(false)
    setSettings({
      recentSearches: [],
      motion: 'calm',
      motionWave: 'breathe',
      preferDownloaded: true,
      theme: 'dark',
      accent: ACCENTS[0]!,
      accentFromCover: false,
      density: 'normal',
      homeLayout: 'calm',
      playerLayout: 'split',
      homeBlocks: DEFAULT_HOME_BLOCKS
    })
    window.showInactive()
    window.setSize(1280, 800)
    await wait(1500)

    const run = async <T>(code: string): Promise<T> =>
      (await window.webContents.executeJavaScript(code)) as T

    const shoot = async (name: string): Promise<void> => {
      const image = await window.webContents.capturePage()
      const file = join(out, `${name}.png`)
      writeFileSync(file, image.toPNG())
      shots.push(file)
    }

    const click = `(label) => {
      const hit = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').includes(label) || (b.title ?? '').includes(label)
      )
      if (hit) { hit.click(); return true }
      return false
    }`

    /** Открыть раздел настроек по подписи в его боковом списке. */
    const pane = async (label: string): Promise<void> => {
      await run<boolean>(`(${click})('Настройки')`)
      await wait(900)
      await run<boolean>(
        `(() => { const n = [...document.querySelectorAll('.settings__navitem')].find((b) => b.textContent.includes(${JSON.stringify(
          label
        )}));
          if (!n) return false; n.click(); return true })()`
      )
      await wait(900)
    }

    /** Подвести нужную карточку под глаз, не двигая остального. */
    const bring = async (selector: string): Promise<void> => {
      await run<boolean>(
        `(() => { const node = document.querySelector(${JSON.stringify(selector)});
          const box = document.querySelector('.app__content');
          if (!node || !box) return false;
          const delta = node.getBoundingClientRect().top - box.getBoundingClientRect().top;
          box.scrollTop += delta - 110;
          return true })()`
      )
      await wait(700)
    }

    // Что-нибудь играет: иначе нижняя панель пустая, а плеер показывать нечего.
    const queue = (await likedTracks()).filter((track) => track.available).slice(0, 25)
    if (queue.length > 0) {
      void command({ type: 'playQueue', tracks: queue, startIndex: 0 })
      await wait(3000)
      void command({ type: 'pause' })
      await wait(500)
    }

    // ---- главная: обе темы и два вида ----
    await run<boolean>(`(${click})('Главная')`)
    await wait(4000)
    await shoot('home')

    setSettings({ theme: 'light' })
    await wait(1100)
    await shoot('home-light')

    setSettings({ theme: 'dark' })
    await wait(900)

    /*
     * Тот же экран другим цветом. Вид главной при этом не меняется нарочно:
     * снимок стоит в README рядом с предыдущим, и разниться между ними должно
     * ровно одно — цвет. Заодно видно, что его берёт и значок Duet слева.
     */
    setSettings({ accent: ACCENTS[3]! })
    await wait(1400)
    await shoot('home-accent')
    setSettings({ accent: ACCENTS[0]! })
    await wait(1200)

    // ---- «Вам нравится»: строки списка со всеми действиями ----
    await run<boolean>(`(${click})('Вам нравится')`)
    await wait(1600)
    await shoot('liked')

    // ---- плеер: два вида ----
    const openPlayer = async (): Promise<void> => {
      await run<boolean>(
        `(() => { const b = document.querySelector('.dock__track'); if (!b) return false; b.click(); return true })()`
      )
      await wait(1600)
    }
    const closePlayer = async (): Promise<void> => {
      /*
       * Кнопка ищется внутри шапки плеера, а не по подписи на всё окно: такая
       * же подпись есть у сворачивания окна в титульной строке, и она лежит в
       * разметке раньше — поиск по подписи сворачивал окно, а плеер оставался
       * открытым, и все следующие снимки выходили одним и тем же.
       */
      await run<boolean>(
        `(() => { const b = document.querySelector('.fullplayer__header button, .ambient__top button');
          if (!b) return false; b.click(); return true })()`
      )
      await wait(900)
      return run<boolean>(`document.querySelector('.fullplayer, .ambient') === null`).then((closed) => {
        if (!closed) throw new Error('плеер не закрылся — снимки дальше будут не те')
      })
    }

    await openPlayer()
    await shoot('player')
    await closePlayer()

    setSettings({ playerLayout: 'ambient' })
    await wait(700)
    await openPlayer()
    await wait(1200)
    await shoot('player-ambient')
    await closePlayer()
    setSettings({ playerLayout: 'split' })
    await wait(600)

    // ---- поиск ----
    await run<boolean>(`(() => {
      const input = document.querySelector('.topbar input')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'ROCK')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const form = input.closest('form')
      if (form) form.requestSubmit()
      return true
    })()`)
    await wait(4500)
    await shoot('search')

    // ---- настройки ----
    await pane('Оформление')
    await shoot('settings-appearance')
    await bring('.hblocks')
    await shoot('settings-blocks')

    await pane('Воспроизведение')
    await bring('.together')
    await shoot('together')

    await pane('Мини-плеер')
    await shoot('settings-mini')

    await pane('О программе')
    await shoot('settings-update')

    // ---- четыре вида мини-плеера ----
    const mini = createMiniPlayer()
    showMiniPlayer()
    await wait(1200)
    for (const variant of ['bar', 'pill', 'card', 'cover'] as const) {
      setSettings({ miniVariant: variant })
      // Плита пересчитывает свой размер сама, дадим ей это сделать.
      await wait(1600)
      const plate = await mini.webContents.capturePage()
      const file = join(out, `mini-${variant}.png`)
      writeFileSync(file, plate.toPNG())
      shots.push(file)
    }
    hideMiniPlayer()
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Доходят ли настройки анимации до стилей.
 *
 * Записать значение в настройки — половина дела; проверяется не оно, а то, что
 * у нужного узла в окне действительно появилась нужная анимация. Поэтому здесь
 * спрашивается вычисленный стиль, а не разметка и не хранилище.
 */
async function runAnimProbe(): Promise<void> {
  const { writeFileSync } = await import('node:fs')
  const report: Record<string, unknown> = { probe: 'anim' }

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)
    const window = getMainWindow()
    if (!window) throw new Error('нет окна оболочки')
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
    setSettings({ sidebarCollapsed: false })
    await wait(1500)

    const run = async <T>(code: string): Promise<T> =>
      (await window.webContents.executeJavaScript(code)) as T

    const animationOf = (selector: string): string =>
      `(() => { const n = document.querySelector('${selector}');` +
      ` return n ? getComputedStyle(n).animationName : 'нет узла' })()`

    // Волна живёт на Главной — туда и смотрим.
    await run(`(() => { const b = [...document.querySelectorAll('button')]
      .find((x) => (x.textContent ?? '').includes('Главная') || (x.title ?? '').includes('Главная'))
      if (b) b.click(); return true })()`)
    await wait(1200)

    const wave: Record<string, string> = {}
    for (const value of ['still', 'breathe', 'drift'] as const) {
      setSettings({ motion: 'calm', motionWave: value })
      await wait(500)
      wave[value] = await run<string>(animationOf('.wave__glow'))
    }

    // Экран: анимация висит на слое, который пересоздаётся при переходе.
    const screens: Record<string, string> = {}
    for (const value of ['none', 'fade', 'slide'] as const) {
      setSettings({ motion: 'calm', motionScreens: value })
      await wait(400)
      screens[value] = await run<string>(animationOf('.app__screen'))
    }

    // Плеер: открываем поверх окна и смотрим, чем он приезжает.
    const player: Record<string, string> = {}
    for (const value of ['sheet', 'zoom', 'fade'] as const) {
      setSettings({ motion: 'calm', motionPlayer: value })
      await wait(400)
      await run(`(() => { const b = document.querySelector('.dock__track'); if (b) b.click(); return true })()`)
      await wait(600)
      player[value] = await run<string>(animationOf('.fullplayer'))
      await run(
        `(() => { const b = document.querySelector('.fullplayer__header button'); if (b) b.click(); return true })()`
      )
      await wait(400)
    }

    // И общий выключатель: он обязан погасить всё разом.
    setSettings({ motion: 'off' })
    await wait(500)
    const off = {
      wave: await run<string>(animationOf('.wave__glow')),
      screen: await run<string>(animationOf('.app__screen')),
      fastMs: await run<string>(
        "getComputedStyle(document.documentElement).getPropertyValue('--t-base').trim()"
      )
    }

    report.system = await run<Record<string, boolean>>(`({
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      moreContrast: matchMedia('(prefers-contrast: more)').matches
    })`)

    report.wave = wave
    report.screens = screens
    report.player = player
    report.off = off
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Доходит ли двойной щелчок до мини-плеера.
 *
 * Плита целиком объявлена drag-поверхностью, чтобы её можно было тянуть за
 * любое место. Windows такие области обрабатывает сама — как заголовок окна, —
 * и события мыши в renderer по ним не приходят. Обработчик двойного щелчка в
 * коде есть; работает ли он на самом деле, можно узнать только настоящим
 * системным щелчком, поэтому проба выкладывает координаты плиты и ждёт, пока
 * по ним щёлкнут снаружи.
 */
async function runMiniProbe(): Promise<void> {
  const { writeFileSync } = await import('node:fs')
  const report: Record<string, unknown> = { probe: 'mini' }

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)

    // Проверяем именно новое поведение: двойной щелчок разворачивает плеер.
    setSettings({ miniDoubleClick: 'openPlayer' })
    const shell = getMainWindow()
    shell?.hide()
    showMiniPlayer()
    await wait(1500)
    const mini = createMiniPlayer()

    // Счётчики: отдельно по drag-поверхности, отдельно по обычной кнопке —
    // так видно, дело в области или в событии вообще.
    await mini.webContents.executeJavaScript(`
      window.__dbl = { drag: 0, any: 0, down: 0 }
      document.addEventListener('dblclick', () => { window.__dbl.any += 1 }, true)
      document.addEventListener('pointerdown', () => { window.__dbl.down += 1 }, true)
      const plate = document.querySelector('.drag')
      if (plate) plate.addEventListener('dblclick', () => { window.__dbl.drag += 1 })
      true
    `)

    const bounds = mini.getBounds()
    writeFileSync(
      (process.env['DUET_MINI_BOUNDS'] as string) ?? 'mini-bounds.json',
      JSON.stringify(bounds)
    )
    report.bounds = bounds

    // Окно щёлкают снаружи; ждём и смотрим, что досчиталось.
    await wait(22_000)
    report.counters = await mini.webContents.executeJavaScript('window.__dbl')
    report.sizeAfter = mini.getBounds()

    // Главное: поднялось ли окно и раскрылся ли плеер во весь экран.
    report.shellVisible = shell?.isVisible() ?? false
    report.miniHidden = !mini.isVisible()
    report.fullPlayerOpen = shell
      ? ((await shell.webContents.executeJavaScript(
          "document.querySelector('.fullplayer') !== null"
        )) as boolean)
      : false
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

async function runShots(): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const out = process.env['DUET_SHOTS'] ?? '.'
  mkdirSync(out, { recursive: true })

  const report: Record<string, unknown> = { probe: 'shots', shots: [] as string[] }
  const shots = report.shots as string[]

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)
    const window = getMainWindow()
    if (!window) throw new Error('нет окна оболочки')
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
    window.setSize(1180, 760)
    // Разворачиваем боковую панель: на снимках она должна быть видна целиком.
    setSettings({ sidebarCollapsed: false })
    await wait(1200)

    // Чтобы плеер было что показывать, ставим трек на паузу в начале.
    const queue = (await likedTracks()).filter((track) => track.available).slice(0, 20)
    if (queue.length > 0) {
      setSettings({ preferDownloaded: true })
      void command({ type: 'playQueue', tracks: queue, startIndex: 0 })
      await wait(2500)
      void command({ type: 'pause' })
      await wait(400)
    }

    const run = async <T>(code: string): Promise<T> =>
      (await window.webContents.executeJavaScript(code)) as T

    const shoot = async (name: string): Promise<void> => {
      const image = await window.webContents.capturePage()
      const file = join(out, `${name}.png`)
      writeFileSync(file, image.toPNG())
      shots.push(file)
    }

    // Кнопку ищем и по подписи, и по всплывающей подсказке: свёрнутый сайдбар
    // показывает одни значки, и текста в кнопке тогда просто нет.
    const click = `(label) => {
      const hit = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').includes(label) || (b.title ?? '').includes(label)
      )
      if (hit) { hit.click(); return true }
      return false
    }`

    for (const theme of ['light', 'dark'] as const) {
      setSettings({ theme })
      await wait(900)

      await run<boolean>(`(${click})('Главная')`)
      await wait(1400)
      await shoot(`${theme}-home`)

      await run<boolean>(`(${click})('Вам нравится')`)
      await wait(1200)
      await shoot(`${theme}-liked`)

      // Полноэкранный плеер — по щелчку на треке в нижней панели.
      await run<boolean>(
        `(() => { const b = document.querySelector('.dock__track'); if (!b) return false; b.click(); return true })()`
      )
      await wait(1000)
      await shoot(`${theme}-player`)
      await run<boolean>(
        `(() => { const b = document.querySelector('.fullplayer__header button'); if (!b) return false; b.click(); return true })()`
      )
      await wait(700)

      await run<boolean>(`(${click})('Настройки')`)
      await wait(1000)
      await shoot(`${theme}-settings`)

      // Плеер «во всё окно» и раздел оформления — новые экраны.
      if (theme === 'dark') {
        setSettings({ playerLayout: 'ambient' })
        await wait(600)
        await run<boolean>(
          `(() => { const b = document.querySelector('.dock__track'); if (!b) return false; b.click(); return true })()`
        )
        await wait(2000)
        await shoot('ambient')
        await run<boolean>(
          `(() => { const b = document.querySelector('.ambient__top button'); if (b) b.click(); return true })()`
        )
        await wait(600)
        setSettings({ playerLayout: 'split' })
      }

      // Поиск: интересует не верх экрана, а низ — там, где плейлисты.
      await run<boolean>(`(() => {
        const input = document.querySelector('.topbar input')
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, 'rock')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        const form = input.closest('form')
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        return true
      })()`)
      await wait(3500)
      await shoot(`${theme}-search-top`)
      await run<boolean>(`(() => {
        const box = document.querySelector('.app__content')
        if (!box) return false
        box.scrollTop = box.scrollHeight
        return true
      })()`)
      await wait(900)
      await shoot(`${theme}-search-bottom`)
      await run<boolean>(`(() => {
        const sections = [...document.querySelectorAll('.search__label')].map((n) => n.textContent)
        window.__duetSearchSections = sections
        return true
      })()`)
      report[`${theme}-sections`] = await run<string[]>('window.__duetSearchSections')

      // Мини-плеер — отдельное окно и своя вёрстка: тему надо проверять и там.
      showMiniPlayer()
      await wait(1200)
      const mini = createMiniPlayer()
      const plate = await mini.webContents.capturePage()
      writeFileSync(join(out, `${theme}-mini.png`), plate.toPNG())
      shots.push(join(out, `${theme}-mini.png`))
      hideMiniPlayer()
      await wait(400)
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

async function runProbe(): Promise<void> {
  const report: Record<string, unknown> = { probe: PROBE }
  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)

    if (PROBE === 'search') {
      report.search = await checkSearch()
    } else {
      const liked = await likedTracks()
      report.liked = await checkLikedMark(liked)
      report.shuffle = await checkShuffle(liked)
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  const { writeFileSync } = await import('node:fs')
  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Что на самом деле возвращает поиск — по сервисам и по видам.
 *
 * Экран умеет рисовать плейлисты, значит теряются они раньше: либо сервис их
 * не отдаёт, либо разбор ответа промахивается мимо. Спрашиваем оба слоя: и
 * готовый результат, и сырой ответ Яндекса.
 */
async function checkSearch(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const queries = ['лучшее', 'rock', 'хиты 2024']

  for (const query of queries) {
    const found = await search(query)
    out[query] = {
      tracks: found.tracks.length,
      albums: found.albums.length,
      artists: found.artists.length,
      playlists: found.playlists.length,
      playlistServices: found.playlists.map((item) => item.service),
      sample: found.playlists.slice(0, 3).map((item) => ({
        title: item.title.slice(0, 30),
        service: item.service,
        nativeId: item.nativeId,
        trackCount: item.trackCount
      }))
    }
  }

  // Чем VK отдаёт плейлисты в поиске — и отдаёт ли. В коде там сейчас пусто,
  // и прежде чем дописывать, надо знать, какой метод существует.
  try {
    const { VkSource } = await import('./sources/vk/source')
    const vk = new VkSource() as unknown as {
      restore: () => Promise<unknown>
      call: (method: string, params: URLSearchParams) => Promise<any>
    }
    await vk.restore()
    const tried: Record<string, unknown> = {}
    for (const method of ['audio.searchPlaylists', 'audio.searchAlbums', 'audio.getPlaylists']) {
      try {
        const params = new URLSearchParams({ q: 'rock', count: '5' })
        const data = await vk.call(method, params)
        const items = data?.items
        tried[method] = Array.isArray(items)
          ? {
              count: items.length,
              fields: items[0] ? Object.keys(items[0]).slice(0, 18) : [],
              first: items[0]
                ? {
                    title: String(items[0].title ?? '').slice(0, 30),
                    id: items[0].id,
                    ownerId: items[0].owner_id,
                    count: items[0].count,
                    type: items[0].type
                  }
                : null
            }
          : data === null
            ? 'метод отказал'
            : 'ответ без items'
      } catch (error) {
        tried[method] = `ошибка: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    out.vkMethods = tried
  } catch (error) {
    out.vkMethods = `ошибка: ${error instanceof Error ? error.message : String(error)}`
  }

  // Сырой ответ Яндекса: видно, приходят ли плейлисты вообще и под каким видом.
  try {
    const { YandexSource } = await import('./sources/yandex/source')
    const source = new YandexSource() as unknown as {
      restore: () => Promise<unknown>
      api?: { get: <T>(path: string) => Promise<T> }
    }
    await source.restore()
    const api = source.api
    if (api) {
      const raw = (await (api as unknown as {
        get: <T>(path: string) => Promise<T>
      }).get('/search?text=' + encodeURIComponent('лучшее') + '&type=all&page=0&nocorrect=false')) as Record<
        string,
        unknown
      >
      const playlists = (raw?.playlists ?? null) as Record<string, unknown> | null
      out.yandexRaw = {
        keys: Object.keys(raw ?? {}),
        hasPlaylists: playlists !== null,
        playlistsKeys: playlists ? Object.keys(playlists) : [],
        playlistsTotal: playlists ? (playlists.total ?? null) : null,
        firstPlaylist: playlists && Array.isArray(playlists.results) ? playlists.results[0] : null
      }
    } else {
      out.yandexRaw = 'нет подключения'
    }
  } catch (error) {
    out.yandexRaw = `ошибка: ${error instanceof Error ? error.message : String(error)}`
  }

  return out
}

/**
 * Горит ли сердечко на уже лайкнутом треке, пришедшем не из библиотеки.
 *
 * Берутся именно те пути, которые про избранное молчат: список исполнителя у
 * VK и содержимое альбома у Яндекса. Там трек приходит с чужими
 * идентификаторами — у VK вообще с другим владельцем, — и отметку подставить
 * может только сама библиотека.
 */
async function checkLikedMark(liked: Track[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}

  const vk = liked.find((track) => track.service === 'vk' && track.artistRefs.length > 0)
  if (vk) {
    const fromArtist = await artistTracks('vk', vk.artistRefs[0]!.nativeId)
    const twin = fromArtist.find((track) => same(track, vk))
    out.vk = {
      track: vk.title.slice(0, 30),
      foundAmongArtistTracks: twin !== undefined,
      sameNativeId: twin?.nativeId === vk.nativeId,
      marksLiked: twin?.liked ?? null
    }
  }

  const yandex = liked.find((track) => track.service === 'yandex' && track.albumId)
  if (yandex) {
    const fromAlbum = await albumTracks('yandex', yandex.albumId!)
    const twin = fromAlbum.find((track) => same(track, yandex))
    out.yandex = {
      track: yandex.title.slice(0, 30),
      foundOnAlbum: twin !== undefined,
      marksLiked: twin?.liked ?? null
    }
  }

  return out
}

function same(a: Track, b: Track): boolean {
  return a.title === b.title && a.artists.join() === b.artists.join()
}

/**
 * Переживает ли перемешивание выбор нового списка. Именно здесь оно и гасло:
 * включить тумблер и нажать трек в «Вам нравится» означало его выключить.
 */
async function checkShuffle(liked: Track[]): Promise<Record<string, unknown>> {
  const queue = liked.filter((track) => track.available).slice(0, 60)
  const half = queue.slice(30)

  void command({ type: 'playQueue', tracks: queue, startIndex: 0 })
  await wait(2500)
  void command({ type: 'toggleShuffle' })
  await wait(400)
  const shuffled = getPlayer()

  // Тот самый шаг: слушатель выбирает список, уже включив перемешивание.
  void command({ type: 'playQueue', tracks: half, startIndex: 0 })
  await wait(2500)
  const after = getPlayer()

  // И главное: кнопка «Перемешать» на самом списке. Она обязана включить
  // именно его и вперемешку — на пустом плеере тоже.
  void command({ type: 'clearQueue' })
  await wait(600)
  void command({ type: 'playQueue', tracks: half, startIndex: 0, shuffle: true })
  await wait(2500)
  const fromButton = getPlayer()

  return {
    flagAfterToggle: shuffled.shuffle,
    orderChangedOnToggle:
      queue.map((t) => t.id).join() !== shuffled.queue.map((t) => t.id).join(),
    flagSurvivesNewList: after.shuffle,
    newListShuffled: half.map((t) => t.id).join() !== after.queue.map((t) => t.id).join(),
    clickedTrackPlays: after.queue[after.index]?.id === half[0]?.id,
    buttonFromEmpty: {
      queueLoaded: fromButton.queue.length === half.length,
      flagOn: fromButton.shuffle,
      orderChanged: half.map((t) => t.id).join() !== fromButton.queue.map((t) => t.id).join(),
      startsSomewhereElse: fromButton.queue[0]?.id !== half[0]?.id,
      playing: fromButton.playing
    }
  }
}

const marks: Record<string, number> = {}

/** Отметить момент запуска. Миллисекунды от старта процесса. */
export function mark(name: string): void {
  if (!REPORT) return
  marks[name] = Math.round(performance.now())
}

interface CatalogueRow {
  call: string
  ms: number
  kb: number
  items: number
}

interface PlaybackRow {
  what: string
  track: string
  ms: number
}

/**
 * Чем занят главный процесс.
 *
 * Первая попытка мерила это таймером на 50 мс и показывала стабильные 12,5 мс
 * «задержки» — но это не занятость, а системный тик Windows в 15,6 мс, в
 * который таймер округляется. Здесь два показателя, которым гранулярность
 * таймера не мешает: сколько миллисекунд процессорного времени уходит на
 * каждую секунду жизни, и гистограмма libuv.
 */
async function measureMain(spanMs: number): Promise<Record<string, number | boolean>> {
  const loop = monitorEventLoopDelay({ resolution: 10 })
  loop.enable()

  // Замер обязан сказать, что он застал. Прогон, где «окно проигрывания»
  // пришлось на паузу, выглядит как блестящая оптимизация, и отличить одно
  // от другого можно только по этим полям и числу тиков.
  let updates = 0
  const off = onPlayerChanged(() => {
    updates += 1
  })
  const playingAtStart = lastKnownPlaying
  // Электрон считает загрузку процессов от прошлого обращения, поэтому здесь
  // отсчёт обнуляется, а читается он в конце окна.
  app.getAppMetrics()
  const cpuAt = process.cpuUsage()
  const at = performance.now()

  await wait(spanMs)

  const spent = process.cpuUsage(cpuAt)
  const elapsed = performance.now() - at
  const playingAtEnd = lastKnownPlaying
  const processes = processLoad()
  off()
  loop.disable()

  return {
    playing: playingAtStart && playingAtEnd,
    updatesPerSecond: round(updates / (elapsed / 1000)),
    cpuMsPerSecond: round((spent.user + spent.system) / 1000 / (elapsed / 1000)),
    shellCpuPercent: processes.shell,
    audioCpuPercent: processes.audio,
    gpuCpuPercent: processes.gpu,
    loopP50: round(loop.percentile(50) / 1e6),
    loopP99: round(loop.percentile(99) / 1e6),
    loopMax: round(loop.max / 1e6)
  }
}

/**
 * Во что обходится окно. Главный процесс — не то место, где живёт «лагает»:
 * там всего проценты. Рисует оболочка, и её загрузку видно только отсюда —
 * Электрон считает её сам, по каждому процессу отдельно.
 */
function processLoad(): { shell: number; audio: number; gpu: number } {
  const shellPid = getMainWindow()?.webContents.getOSProcessId() ?? -1
  const out = { shell: 0, audio: 0, gpu: 0 }
  for (const metric of app.getAppMetrics()) {
    const percent = round(metric.cpu?.percentCPUUsage ?? 0)
    if (metric.pid === shellPid) out.shell = percent
    else if (metric.type === 'GPU') out.gpu = percent
    // Скрытое окно со звуком — единственный оставшийся заметный потребитель.
    else if (metric.type === 'Tab' && metric.pid !== shellPid) out.audio = Math.max(out.audio, percent)
  }
  return out
}

/**
 * Довести плеер до звучания перед замером. Иначе достаточно одного трека с
 * мёртвой ссылкой, чтобы «цена воспроизведения» оказалась ценой тишины.
 */
async function ensurePlaying(): Promise<boolean> {
  if (lastKnownPlaying) return true
  const sounded = new Promise<boolean>((resolve) => {
    const off = onPlayerChanged((player) => {
      if (!player.playing) return
      off()
      resolve(true)
    })
    setTimeout(() => {
      off()
      resolve(false)
    }, 20_000)
  })
  void command({ type: 'play' })
  return sounded
}

/** Прогнать сценарий и выйти. Вызывается один раз, из старта приложения. */
async function runScenario(): Promise<void> {
  if (!REPORT) return

  const report: Record<string, unknown> = { startedAt: new Date().toISOString() }

  try {
    // Библиотека читается на старте; без неё мерить каталог нечего.
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)

    // Тишина: сценарий играет настоящие треки, и слушать их никто не просил.
    command({ type: 'setVolume', volume: 0 })

    report.catalogue = await measureCatalogue()

    const { playback, tracks } = await measurePlayback()
    report.playback = playback
    report.queueSize = tracks

    // Окно и главный процесс меряются одновременно и по одному и тому же
    // отрезку — иначе это два разных пятисекундных куска жизни.
    report.reachedSound = await ensurePlaying()
    const [renderer, playing] = await Promise.all([measureRenderer(SPAN_MS), measureMain(SPAN_MS)])
    report.renderer = renderer
    report.mainWhilePlaying = playing

    // То же самое на паузе: разница и есть цена воспроизведения.
    command({ type: 'pause' })
    await wait(500)
    report.mainWhileIdle = await measureMain(SPAN_MS)

    // Экран и прокрутка — то, что человек называет «лагает».
    report.screens = await measureScreens()

    // Статус Discord: обновляется ли на перемотку и переживает ли серию
    // пропусков. Проверка играет музыку, поэтому идёт до подсчёта итогов.
    report.discord = { ...(await measureDiscord()), ...discordStats() }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  report.marks = marks
  writeFileSync(REPORT, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Во что обходится открыть экран. Каждый вызов меряется дважды: первый — как
 * при запуске, второй — по прогретому кэшу, и разрыв между ними показывает,
 * сколько стоит сам перенос данных, а сколько — поход в сеть.
 */
async function measureCatalogue(): Promise<CatalogueRow[]> {
  const rows: CatalogueRow[] = []

  const run = async (call: string, load: () => Promise<unknown>): Promise<void> => {
    const at = performance.now()
    const data = await load()
    const ms = round(performance.now() - at)
    const json = JSON.stringify(data)
    rows.push({
      call,
      ms,
      kb: round(json.length / 1024),
      items: Array.isArray(data) ? data.length : 0
    })
  }

  await run('home (1)', () => home())
  await run('home (2)', () => home())
  await run('liked (1)', () => likedTracks())
  await run('liked (2)', () => likedTracks())
  await run('playlists', () => playlists())

  return rows
}

/**
 * Сколько проходит от команды до первого звука.
 *
 * Меряется дважды, и это важно: у скачанного трека путь совсем другой — файл
 * с диска через собственный протокол, без единого обращения к сервису. Если
 * мерить только его, любая работа над сетевым путём выглядит бесполезной.
 */
async function measurePlayback(): Promise<{ playback: PlaybackRow[]; tracks: number }> {
  const rows: PlaybackRow[] = []
  const queue = (await likedTracks()).filter((track) => track.available)
  if (queue.length === 0) return { playback: rows, tracks: 0 }

  const restore = getSettings().preferDownloaded
  try {
    setSettings({ preferDownloaded: false })
    // Два прохода по сети, и разница между ними и есть вся суть предзагрузки:
    // подряд нажатое «дальше» не оставляет запасу времени, а обычное
    // прослушивание — оставляет целый трек.
    await runPass('сеть · подряд', queue, rows, 0)
    await runPass('сеть · с запасом', queue, rows, DWELL_MS)
    setSettings({ preferDownloaded: true })
    await runPass('диск · с запасом', queue, rows, DWELL_MS)
  } finally {
    setSettings({ preferDownloaded: restore })
  }

  return { playback: rows, tracks: queue.length }
}

/** Сколько играет трек, прежде чем замер переключит следующий. */
const DWELL_MS = 4000

async function runPass(
  pass: string,
  queue: Track[],
  rows: PlaybackRow[],
  dwellMs: number
): Promise<void> {
  const name = (track: Track | undefined): string =>
    track ? `${track.service}:${track.title}`.slice(0, 40) : '—'

  // Первый трек: очередь ещё не загружена, ссылку надо получить с нуля.
  rows.push({
    what: `${pass} · первый`,
    track: name(queue[0]),
    ms: await timeToSound(queue[0]!.id, () =>
      void command({ type: 'playQueue', tracks: queue, startIndex: 0 })
    )
  })

  // Следующие: именно здесь предзагрузка должна свести задержку к нулю.
  for (let i = 1; i <= 3 && i < queue.length; i += 1) {
    await wait(dwellMs)
    rows.push({
      what: `${pass} · дальше`,
      track: name(queue[i]),
      ms: await timeToSound(queue[i]!.id, () => void command({ type: 'next' }))
    })
  }
}

/**
 * Выдать команду и дождаться, когда пойдёт звук именно этого трека.
 *
 * Ждать одного лишь `playing` нельзя: в момент команды ещё играет предыдущий
 * трек, и первое же состояние отвечало бы «уже звучит» — замер показывал бы
 * единицы миллисекунд там, где на деле поход в сеть.
 */
async function timeToSound(expectedId: string, issue: () => void): Promise<number> {
  const at = performance.now()
  const sounded = new Promise<void>((resolve) => {
    // Слушаем сам аудиоэлемент, а не состояние плеера.
    //
    // С двумя элементами звук между треками не прерывается, и состояние всё
    // это время честно говорит «играет» — от предыдущего трека. Замер по нему
    // показывал бы единицы миллисекунд даже там, где новый трек ещё молчит.
    // Событие 'playing' приходит от того элемента, который действительно
    // зазвучал, и соврать не может.
    const listener = (_event: unknown, audio: AudioEvent): void => {
      if (audio.type !== 'playing') return
      if (state()?.id !== expectedId) return
      ipcMain.removeListener(IPC.audioEvent, listener)
      resolve()
    }
    ipcMain.on(IPC.audioEvent, listener)
    // Ждать надо дольше, чем ждёт сторож загрузки, иначе замер сдаётся ровно
    // в ту секунду, когда плеер начинает выбираться из тишины, и выздоровление
    // не попадает в отчёт.
    setTimeout(() => {
      ipcMain.removeListener(IPC.audioEvent, listener)
      resolve()
    }, 25_000)
  })
  issue()
  await sounded
  return round(performance.now() - at)
}

/** Трек, который сейчас под курсором очереди. */
function state(): Track | null {
  return lastQueueTrack
}

let lastQueueTrack: Track | null = null
let lastKnownPlaying = false
onPlayerChanged((player) => {
  lastQueueTrack = player.queue[player.index] ?? null
  lastKnownPlaying = player.playing
})

/**
 * Что происходит в окне, пока играет музыка. Перерисовки считает сама
 * оболочка — счётчик в App.tsx; здесь снимаются два его значения с паузой,
 * так что видно именно частоту, а не накопленное с запуска число.
 */
async function measureRenderer(spanMs: number): Promise<Record<string, number> | { error: string }> {
  const window = getMainWindow()
  if (!window || window.isDestroyed()) return { error: 'нет окна оболочки' }

  // Скрытое окно рисует примерно раз в секунду — при замере это соврало бы.
  window.webContents.setBackgroundThrottling(false)
  const read = async (): Promise<number> =>
    (await window.webContents.executeJavaScript('window.__duetRenders ?? 0')) as number

  const before = await read()
  await wait(spanMs)
  const after = await read()

  const domNodes = (await window.webContents.executeJavaScript(
    'document.getElementsByTagName("*").length'
  )) as number

  return {
    renders: after - before,
    rendersPerSecond: round(((after - before) * 1000) / spanMs),
    domNodes
  }
}

/**
 * Как ведёт себя окно под нагрузкой, ради которой всё и затевалось: открыть
 * список из тысяч треков и проскроллить его.
 *
 * Мерить покой было бесполезно — в покое оболочка занимает доли процента.
 * Жалоба была про открытие экрана и про скролл, и меряется здесь именно это:
 * сколько проходит от нажатия до первой отрисованной строки и какие кадры
 * выходят при непрерывной прокрутке.
 */
async function measureScreens(): Promise<Record<string, unknown>> {
  const window = getMainWindow()
  if (!window || window.isDestroyed()) return { error: 'нет окна оболочки' }
  window.webContents.setBackgroundThrottling(false)
  // Скрытое окно не рисует кадры: requestAnimationFrame в нём срабатывает раз
  // в секунду, и любая прокрутка выглядела бы катастрофой. Показываем без
  // фокуса — замер не должен уводить курсор из-под рук.
  const wasVisible = window.isVisible()
  if (!wasVisible) window.showInactive()
  await wait(700)

  const script = `(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const frames = []
    const out = {}

    const click = (text) => {
      const hit = [...document.querySelectorAll('button')]
        .find((b) => (b.textContent ?? '').includes(text))
      if (hit) hit.click()
      return !!hit
    }

    // Уйти с экрана, где треки уже нарисованы, иначе открытие измерится нулём:
    // на Главной тот же список лайков и те же строки.
    click('Настройки')
    for (let i = 0; i < 200; i += 1) {
      if (!document.querySelector('.trackrow')) break
      await wait(25)
    }

    // Открыть «Вам нравится» и дождаться первой строки.
    const at = performance.now()
    out.clicked = click('Вам нравится')
    for (let i = 0; i < 200; i += 1) {
      if (document.querySelector('.trackrow')) break
      await wait(25)
    }
    out.openMs = Math.round(performance.now() - at)
    out.rows = document.querySelectorAll('.trackrow').length

    // Сколько стоит перенос каталога в окно. Главная и «Вам нравится» везут
    // по два с лишним мегабайта треков каждая, и меряется здесь именно дорога
    // через IPC, а не работа в главном процессе.
    const ipcAt = performance.now()
    const liked = await window.shell.liked()
    out.ipcLikedMs = Math.round(performance.now() - ipcAt)
    out.ipcLikedTracks = liked.length
    const homeAt = performance.now()
    await window.shell.home()
    out.ipcHomeMs = Math.round(performance.now() - homeAt)

    const scroller = document.querySelector('.app__content')
    if (!scroller) return { ...out, error: 'нет прокручиваемой области' }

    // Непрерывная прокрутка: шаг на каждый кадр, замеряется длина кадров.
    await new Promise((done) => {
      let last = performance.now()
      let steps = 0
      const step = () => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        scroller.scrollTop += 220
        steps += 1
        if (steps < 180) requestAnimationFrame(step)
        else done()
      }
      requestAnimationFrame(step)
    })

    // Первый кадр меряет паузу до начала, а не прокрутку.
    const sorted = frames.slice(1).sort((a, b) => a - b)
    const at_ = (f) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] * 10) / 10
    return {
      ...out,
      scrolledTo: Math.round(scroller.scrollTop),
      frames: sorted.length,
      frameP50: at_(0.5),
      frameP95: at_(0.95),
      frameMax: Math.round(sorted[sorted.length - 1] * 10) / 10,
      janky: sorted.filter((ms) => ms > 32).length
    }
  })()`

  const result = (await window.webContents.executeJavaScript(script)) as Record<string, unknown>
  if (!wasVisible) window.hide()
  return result
}

/**
 * Проверка статуса Discord по двум жалобам: «при перемотке не обновляется» и
 * «если пропустить много треков подряд — ломается».
 *
 * Обе проверяются поведением, а не чтением кода: перемотка обязана вызвать
 * отправку, а после серии пропусков в статусе обязан оказаться именно тот
 * трек, который в итоге играет, — раньше там застывал давно сыгранный, потому
 * что Discord глушил того, кто частит.
 */
async function measureDiscord(): Promise<Record<string, unknown>> {
  const before = discordStats()
  if (!before.connected) return { connected: false }

  // Перемотка далеко вперёд: часы Discord обязаны переехать.
  void command({ type: 'seek', positionMs: 95_000 })
  await wait(4500)
  const afterSeek = discordStats()

  // Шесть пропусков подряд — ровно тот случай, в котором статус ломался.
  const skips = 6
  for (let i = 0; i < skips; i += 1) {
    void command({ type: 'next' })
    await wait(150)
  }
  await wait(5000)
  const afterSkips = discordStats()
  const playing = getPlayer()
  const current = playing.queue[playing.index]?.id ?? null

  return {
    connected: afterSkips.connected,
    seekPushed: afterSeek.sent > before.sent,
    skips,
    sentDuringSkips: afterSkips.sent - afterSeek.sent,
    showsCurrentTrack: afterSkips.showing === current
  }
}

// ---- мелочи ----

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(done: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!done()) {
    if (Date.now() > deadline) throw new Error('не дождались готовности библиотеки')
    await wait(200)
  }
}

/**
 * Снимки того, что чинилось по списку: Главная без «Скачанного», сегмент в
 * поиске и его отступ слева, правый край нижней панели с громкостью, списки в
 * настройках мини-плеера.
 */
async function runLookProbe(): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const out = process.env['DUET_SHOTS'] ?? '.'
  mkdirSync(out, { recursive: true })

  const report: Record<string, unknown> = { probe: 'look', shots: [] as string[], notes: [] as string[] }
  const shots = report.shots as string[]
  const notes = report.notes as string[]

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)
    const window = getMainWindow()
    if (!window) throw new Error('нет окна оболочки')
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
    window.setSize(1180, 760)
    await wait(1200)

    const run = async <T>(code: string): Promise<T> =>
      (await window.webContents.executeJavaScript(code)) as T

    const shoot = async (name: string): Promise<void> => {
      const image = await window.webContents.capturePage()
      const file = join(out, `${name}.png`)
      writeFileSync(file, image.toPNG())
      shots.push(file)
    }

    const click = `(label) => {
      const hit = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').includes(label) || (b.title ?? '').includes(label)
      )
      if (hit) { hit.click(); return true }
      return false
    }`

    // Что-нибудь должно играть — иначе нижняя панель пустая.
    const queue = (await likedTracks()).filter((track) => track.available).slice(0, 12)
    if (queue.length > 0) {
      void command({ type: 'playQueue', tracks: queue, startIndex: 0 })
      await wait(2500)
      void command({ type: 'pause' })
      await wait(400)
    }

    // 1. Главная: «Скачанное» выключено в настройках — его быть не должно.
    setSettings({ homeBlocks: DEFAULT_HOME_BLOCKS })
    await run<boolean>(`(${click})('Главная')`)
    await wait(1500)
    notes.push(
      `главная, заголовки блоков: ${await run<string>(
        `[...document.querySelectorAll('.home__title')].map((n) => n.textContent).join(' | ')`
      )}`
    )
    await shoot('look-home')

    // 2. Поиск: сегмент вместо чипов и отступ поля слева.
    await run<boolean>(
      `(() => { const i = document.querySelector('.topbar__search input'); if (!i) return false;
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(i, 'кино'); i.dispatchEvent(new Event('input', { bubbles: true }));
        i.closest('form').requestSubmit(); return true })()`
    )
    await wait(3500)
    notes.push(
      `поиск: сегментов=${await run<number>(`document.querySelectorAll('.search__kinds .seg').length`)}, ` +
        `чипов-фильтров=${await run<number>(`document.querySelectorAll('.search__kinds .chip').length`)}, ` +
        `поле слева=${await run<number>(`Math.round(document.querySelector('.topbar__search').getBoundingClientRect().left)`)}px`
    )
    await shoot('look-search')

    // 3. Нижняя панель: ширина кнопок устройства и таймера, окно громкости.
    notes.push(
      `нижняя панель: ${await run<string>(
        `[...document.querySelectorAll('.dock__right .gbtn--labelled')].map((n) => n.textContent.trim() + '=' + Math.round(n.getBoundingClientRect().width) + 'px').join(', ')`
      )}`
    )
    await run<boolean>(`(${click})('Громкость')`)
    await wait(600)
    notes.push(
      `окно громкости: ширина=${await run<number>(
        `Math.round((document.querySelector('.pop__panel--vol')?.getBoundingClientRect().width) ?? -1)`
      )}px, столбик=${await run<string>(
        `(() => { const b = document.querySelector('.vbar'); if (!b) return 'нет'; const r = b.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) })()`
      )}`
    )
    await shoot('look-volume')

    // Проверяем счёт доли по вертикали: щелчок в четверти снизу — это 25%.
    const volume = await run<number>(
      `(() => { const b = document.querySelector('.vbar'); if (!b) return -1;
        const r = b.getBoundingClientRect();
        const at = (share) => { const e = { clientY: r.bottom - r.height * share, pointerId: 1, bubbles: true };
          const down = new PointerEvent('pointerdown', e); b.dispatchEvent(down); };
        at(0.25); return 1 })()`
    )
    await wait(500)
    notes.push(`щелчок в четверти снизу → громкость ${Math.round(getPlayer().volume * 100)}% (ждём 25%), вернул ${volume}`)

    // 3б. Та же панель в широком окне — там подписи не прячутся.
    window.setSize(1640, 922)
    await wait(900)
    notes.push(
      `панель при 1640: ${await run<string>(
        `[...document.querySelectorAll('.dock__right .gbtn--labelled')].map((n) => n.textContent.trim() + '=' + Math.round(n.getBoundingClientRect().width) + 'px').join(', ')`
      )}`
    )
    notes.push(
      `правый край панели: ${await run<string>(
        `(() => { const r = document.querySelector('.dock__right'); const d = document.querySelector('.dock');
          return Math.round(d.getBoundingClientRect().right - r.getBoundingClientRect().right) + 'px запаса' })()`
      )}`
    )
    await shoot('look-dock-wide')

    // 4. Настройки мини-плеера: выпадающие списки в разделе «Положение».
    await run<boolean>(`(${click})('Настройки')`)
    await wait(1200)
    await run<boolean>(
      `(() => { const n = [...document.querySelectorAll('.settings__navitem')].find((b) => b.textContent.includes('Мини-плеер'));
        if (!n) return false; n.click(); return true })()`
    )
    await wait(900)
    await run<boolean>(
      `(() => { const s = document.querySelector('select.select'); if (!s) return false;
        s.scrollIntoView({ block: 'center' }); return true })()`
    )
    await wait(600)
    notes.push(
      `списки в настройках: ${await run<string>(
        `[...document.querySelectorAll('select.select')].map((n) => { const s = getComputedStyle(n); return Math.round(n.getBoundingClientRect().width) + 'px r' + s.borderRadius }).join(', ') || 'нет'`
      )}`
    )
    await shoot('look-mini-settings')

    report.ok = true
  } catch (error) {
    report.error = String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Есть ли у VK «не нравится» для трека — под каким угодно именем.
 *
 * Три имени уже проверялись и отказали, но отказ отказу рознь: у VK код 3
 * значит «такого метода нет», а всё остальное — «метод есть, но не для нас».
 * Различить их можно только по сырому ответу, поэтому здесь берётся сам клиент,
 * а не обёртка, которая прячет ошибку.
 */
async function runVkDislikeProbe(): Promise<void> {
  const report: Record<string, unknown> = { probe: 'vkdislike' }

  const NAMES = [
    'audio.dislike',
    'audio.setDislike',
    'audio.addDislike',
    'audio.dislikeAudio',
    'audio.dislikeRecommendation',
    'audio.hide',
    'audio.hideAudio',
    'audio.hideRecommendation',
    'audio.getDislikedAudios',
    'audio.removeFromRecommendations',
    'audio.setBlacklist',
    'audio.addToBlacklist',
    'audio.notInterested',
    'audio.setStreamMixFeedback',
    'audio.sendStreamMixFeedback',
    'audio.markAsUninteresting',
    'newsfeed.ignoreItem'
  ]

  try {
    const { VkSource } = await import('./sources/vk/source')
    const vk = new VkSource() as unknown as {
      restore: () => Promise<unknown>
      isConnected: () => boolean
      wave: () => Promise<Track[]>
      client: { request: <T>(method: never, params: URLSearchParams) => Promise<T> } | null
    }
    await vk.restore()
    report.connected = vk.isConnected()
    if (!vk.isConnected()) throw new Error('VK не подключён в этом профиле')

    // Настоящий трек из волны: на выдуманном номере всякий метод ответит
    // отказом, и отличить «нет метода» от «плохой номер» станет нельзя.
    const wave = await vk.wave()
    const track = wave[0]
    report.track = track ? `${track.title} (${track.nativeId})` : 'волна пуста'
    const [ownerId, audioId] = (track?.nativeId ?? '0_0').split('_')

    const tried: Record<string, unknown> = {}
    for (const method of NAMES) {
      const params = new URLSearchParams({
        audio_id: String(audioId),
        owner_id: String(ownerId),
        audio: `${ownerId}_${audioId}`,
        type: 'audio',
        item_id: String(audioId)
      })
      try {
        const res = (await vk.client!.request<Record<string, any>>(method as never, params)) as any
        tried[method] = res?.success
          ? { ответил: JSON.stringify(res.data?.response ?? null).slice(0, 200) }
          : {
              код: res?.data?.error?.error_code ?? res?.error?.error_code ?? '?',
              текст: String(
                res?.data?.error?.error_msg ?? res?.error?.error_msg ?? JSON.stringify(res).slice(0, 200)
              )
            }
      } catch (error) {
        tried[method] = `бросил: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    report.methods = tried
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Работает ли «не нравится» у VK на деле.
 *
 * Отметка ставится на настоящем треке настоящей волны, а потом волна
 * запрашивается снова: в ней отвергнутого быть не должно. Профиль у замера
 * свой, копия, так что настройки настоящего аккаунта это не трогает.
 */
async function runVkBanProbe(): Promise<void> {
  const report: Record<string, unknown> = { probe: 'vkban' }

  try {
    const { VkSource } = await import('./sources/vk/source')
    const vk = new VkSource()
    await (vk as unknown as { restore: () => Promise<unknown> }).restore()
    report.connected = vk.isConnected()
    if (!vk.isConnected()) throw new Error('VK не подключён в этом профиле')
    report.canDislike = vk.canDislike()

    setSettings({ vkDisliked: [] })

    const first = await vk.wave()
    report.первыйЗаход = first.length
    const victim = first[0]
    if (!victim) throw new Error('волна пуста — отмечать нечего')
    report.отмеченный = `${victim.title} — ${victim.artists.join(', ')} (${victim.nativeId})`

    await vk.dislike(victim)
    const stored = getSettings().vkDisliked
    report.списокПослеОтметки = stored
    report.попалВСписок = stored.includes(victim.nativeId)

    // Вычёркивается ли он из того, что приходит дальше. Волна VK крутится на
    // их стороне, поэтому берём несколько заходов: повторы у неё бывают, и
    // именно на повторе отметка и должна сработать.
    const seen: string[] = []
    let leaked = 0
    for (let i = 0; i < 4; i += 1) {
      const batch = await vk.wave()
      for (const track of batch) {
        seen.push(track.nativeId)
        if (stored.includes(track.nativeId)) leaked += 1
      }
      await wait(600)
    }
    report.тряхнулиВолну = seen.length
    report.повторыОтмеченного = leaked
    report.отмеченныйПросочился = leaked > 0

    // Заодно: отметим весь один заход целиком и посмотрим, сколько отсеется на
    // следующем — это и есть мера того, как часто волна повторяется.
    const wide = await vk.wave()
    setSettings({ vkDisliked: wide.map((track) => track.nativeId) })
    const after = await vk.wave()
    report.следующийЗаход = { всего: after.length, ниОдногоОтмеченного: after.every((t) => !getSettings().vkDisliked.includes(t.nativeId)) }

    report.ok = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Совместное прослушивание целиком: от публикации до прихода события.
 *
 * Проверяется настоящий ретранслятор, а не подделка: смысл проверки в том,
 * доходит ли состояние по-настоящему. Своя же сессия и слушается — движку
 * состояние не отдаётся, чтобы он не гонялся за самим собой.
 */
async function runTogetherProbe(): Promise<void> {
  const report: Record<string, unknown> = { probe: 'together' }

  try {
    const { publish, ensureInvite, listenerCount, resetPublishing } = await import('./together/host')
    const { startFollowing, stopFollowing, isFollowing } = await import('./together/follow')

    setSettings({ listenTogether: true })
    const { code } = ensureInvite()
    report.код = code

    // Что-нибудь должно играть: публикуется то, что стоит под курсором.
    const queue = (await likedTracks()).filter((track) => track.available).slice(0, 4)
    if (queue.length === 0) throw new Error('в избранном нет доступных треков')
    void command({ type: 'playQueue', tracks: queue, startIndex: 0 })
    await waitFor(() => getPlayer().playing, 30_000)
    await wait(1500)

    const playing = getPlayer().queue[getPlayer().index]
    report.ведущийИграет = `${playing?.title} — ${playing?.artists.join(', ')}`

    resetPublishing()
    await publish(getPlayer(), true)
    report.слушателейПослеПервойОтправки = listenerCount()

    // ---- подключаемся к своей же сессии ----
    const heard: { title: string; positionMs: number; playing: boolean }[] = []
    let ended = 0
    let trouble = 0
    const joined = await startFollowing(
      code,
      (shared) => heard.push({
        title: shared.track?.title ?? '—',
        positionMs: shared.positionMs,
        playing: shared.playing
      }),
      () => { ended += 1 },
      () => { trouble += 1 }
    )
    report.подключился = joined
    report.считаетсяПодключённым = isFollowing()

    await waitFor(() => heard.length > 0, 20_000).catch(() => undefined)
    report.первоеСостояние = heard[0] ?? 'не пришло'

    /*
     * Ведущий переключает трек — и ничего руками не публикуем: проверяется
     * именно то, что уходит само. Жалоба была про то, что новый трек у
     * слушателя начинается с того места, где ведущий бросил предыдущий, а
     * такое видно только на самотёке.
     */
    const beforeNext = heard.length
    const leftOffAt = getPlayer().positionMs
    report.броси́лПредыдущийНа = leftOffAt
    void command({ type: 'next' })
    await waitFor(() => heard.length > beforeNext, 25_000).catch(() => undefined)
    const arrived = heard.slice(beforeNext)
    report.послеПереключения = arrived
    report.началоНовогоТрека =
      arrived.length > 0
        ? { позиция: arrived[0]!.positionMs, сначала: arrived[0]!.positionMs < 2500 }
        : 'не пришло'
    report.всегоСостояний = heard.length
    report.слушателей = listenerCount()

    // ---- ведущий ставит паузу ----
    void command({ type: 'pause' })
    await wait(800)
    resetPublishing()
    await publish(getPlayer(), true)
    await waitFor(() => heard.some((item) => !item.playing), 20_000).catch(() => undefined)
    report.паузаДошла = heard.some((item) => !item.playing)

    stopFollowing()
    await wait(500)
    report.послеОтключения = { следуем: isFollowing(), концов: ended, обрывов: trouble }

    // ---- чужой код: отказ, а не бесконечные попытки ----
    const started = Date.now()
    const bogus = await startFollowing('нетакогокода-' + Date.now(), () => undefined, () => undefined)
    report.несуществующаяСессия = { подключился: bogus, заМс: Date.now() - started }
    stopFollowing()

    // ---- обрыв связи: должны вернуться сами ----
    report.переподключение = await checkReconnect()

    setSettings({ listenTogether: false })
    report.ok = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Рвём поток нарочно и смотрим, вернётся ли следование само.
 *
 * Ретранслятор на это время — свой, здешний: настоящий рвать не на чем, а
 * проверять надо ровно поведение при обрыве. Он отдаёт одно событие и
 * закрывает соединение; при втором подключении — другое событие.
 */
async function checkReconnect(): Promise<Record<string, unknown>> {
  const { createServer } = await import('node:http')
  const { startFollowing, stopFollowing } = await import('./together/follow')
  const previousRelay = getSettings().relayUrl

  let connections = 0
  const server = createServer((_request, response) => {
    connections += 1
    const which = connections
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const shared = {
      track: { id: `t${which}`, title: `Трек ${which}`, artists: ['Проверка'] },
      positionMs: which * 1000,
      playing: true,
      at: Date.now()
    }
    response.write(`data: ${JSON.stringify(shared)}

`)
    // Первое соединение рвём — второе держим.
    if (which === 1) setTimeout(() => response.destroy(), 150)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  setSettings({ relayUrl: `http://127.0.0.1:${port}` })

  const heard: string[] = []
  let trouble = 0
  let ended = 0
  const started = Date.now()
  const joined = await startFollowing(
    'проверка',
    (state) => heard.push(String((state.track as { title?: string } | null)?.title ?? '—')),
    () => { ended += 1 },
    () => { trouble += 1 }
  )

  // Первая пауза между попытками — секунда; ждём с запасом.
  await waitFor(() => heard.length > 1, 12_000).catch(() => undefined)
  const elapsed = Date.now() - started

  stopFollowing()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  setSettings({ relayUrl: previousRelay })

  return {
    подключился: joined,
    соединений: connections,
    услышано: heard,
    обрывовЗамечено: trouble,
    сессияЗакончена: ended,
    вернулисьЗаМс: elapsed
  }
}

/**
 * Раздел «О программе» с обновлением.
 *
 * Замер идёт из исходников, и это здесь не помеха, а сама проверка: из
 * исходников обновлять нечего, и приложение должно сказать об этом прямо, а не
 * изображать проверку и не ходить в сеть.
 */
async function runAboutProbe(): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const out = process.env['DUET_SHOTS'] ?? '.'
  mkdirSync(out, { recursive: true })

  const report: Record<string, unknown> = { probe: 'about' }

  try {
    const { getUpdateState, checkForUpdates } = await import('./updates')
    report.состояниеНаСтарте = getUpdateState()
    report.послеПроверкиРуками = await checkForUpdates(true)

    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)
    const window = getMainWindow()
    if (!window) throw new Error('нет окна оболочки')
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
    window.setSize(1180, 760)
    await wait(1200)

    const run = async <T>(code: string): Promise<T> =>
      (await window.webContents.executeJavaScript(code)) as T

    await run<boolean>(
      `(() => { const b = [...document.querySelectorAll('button')].find((n) => (n.title ?? '').includes('Настройки'));
        if (!b) return false; b.click(); return true })()`
    )
    await wait(1000)
    await run<boolean>(
      `(() => { const n = [...document.querySelectorAll('.settings__navitem')].find((b) => b.textContent.includes('О программе'));
        if (!n) return false; n.click(); return true })()`
    )
    await wait(800)

    report.строкаСостояния = await run<string>(
      `[...document.querySelectorAll('.srow')].map((r) => r.textContent.trim()).join(' || ')`
    )
    const image = await window.webContents.capturePage()
    const file = join(out, 'about.png')
    writeFileSync(file, image.toPNG())
    report.снимок = file

    report.ok = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}

/**
 * Читается ли выбранный сегмент.
 *
 * Жалоба была про «Мою волну» в светлой теме: выбранный сервис становился
 * белым по белому. Проверяются обе темы сразу — и «Моя волна», которая лежит
 * на обложке, и обычный сегмент в титульной строке: починка одного легко
 * ломает другое, потому что цвет у них общий.
 */
async function runSegProbe(): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const out = process.env['DUET_SHOTS'] ?? '.'
  mkdirSync(out, { recursive: true })

  const report: Record<string, unknown> = { probe: 'seg' }

  try {
    await waitFor(() => marks['libraryWarm'] !== undefined, 120_000)
    const window = getMainWindow()
    if (!window) throw new Error('нет окна оболочки')
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
    window.setSize(1280, 800)
    await wait(1200)

    const run = async <T>(code: string): Promise<T> =>
      (await window.webContents.executeJavaScript(code)) as T

    await run<boolean>(
      `(() => { const b = [...document.querySelectorAll('button')].find((n) => (n.title ?? '').includes('Главная'));
        if (!b) return false; b.click(); return true })()`
    )
    await wait(2500)

    /*
     * Контраст числом здесь не посчитать: «Моя волна» лежит на картинке, а
     * вычисленный стиль знает цвета, а не пиксели, — сложить полупрозрачную
     * плашку с обложкой нечем, и любое число вышло бы выдуманным. Зато саму
     * поломку видно точно: белым по белому сегмент становился тогда, когда
     * заливка была сплошной и совпадала с цветом текста.
     */
    const measure = `(selector) => {
      const node = document.querySelector(selector)
      if (!node) return { нет: selector }
      const style = getComputedStyle(node)
      const parts = (value) => (value.match(/[0-9.]+/g) || []).map(Number)
      const bg = parts(style.backgroundColor)
      const fg = parts(style.color)
      const opaque = bg.length < 4 || bg[3] === 1
      const same = opaque && bg[0] === fg[0] && bg[1] === fg[1] && bg[2] === fg[2]
      return { текст: style.color, фон: style.backgroundColor, белоеПоБелому: same }
    }`

    for (const theme of ['light', 'dark'] as const) {
      setSettings({ theme })
      await wait(900)
      report[`волна_${theme}`] = await run(
        `(${measure})('.on-media .seg > button[aria-pressed="true"]')`
      )
      report[`титульная_${theme}`] = await run(
        `(${measure})('.topbar .seg > button[aria-pressed="true"]')`
      )
      const image = await window.webContents.capturePage()
      writeFileSync(join(out, `seg-${theme}.png`), image.toPNG())
    }

    report.ok = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  }

  writeFileSync(REPORT as string, JSON.stringify(report, null, 2))
  app.exit(0)
}
