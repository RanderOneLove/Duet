import { app, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import type { Track } from '@shared/domain'
import { IPC } from '@shared/ipc'
import type { AudioEvent } from '../preload/audio'
import { command, onPlayerChanged } from './player/engine'
import { getSettings, setSettings } from './state/settings'
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
  if (PROBE === 'readme') return runReadmeShots()
  if (PROBE === 'anim') return runAnimProbe()
  if (PROBE === 'mini') return runMiniProbe()
  if (PROBE === 'shots') return runShots()
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
      sidebarCollapsed: false,
      recentSearches: [],
      motion: 'calm',
      motionWave: 'breathe',
      preferDownloaded: true
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

    // Что-нибудь играет: иначе нижняя панель пустая, а плеер показывать нечего.
    const queue = (await likedTracks()).filter((track) => track.available).slice(0, 25)
    if (queue.length > 0) {
      void command({ type: 'playQueue', tracks: queue, startIndex: 0 })
      await wait(3000)
      void command({ type: 'pause' })
      await wait(500)
    }

    // ---- главное окно, обе темы ----
    for (const theme of ['dark', 'light'] as const) {
      setSettings({ theme })
      await wait(900)
      await run<boolean>(`(${click})('Главная')`)
      await wait(1600)
      await shoot(theme === 'dark' ? 'home' : 'home-light')
    }

    setSettings({ theme: 'dark' })
    await wait(700)

    // ---- полноэкранный плеер ----
    await run<boolean>(
      `(() => { const b = document.querySelector('.nowplaying__track'); if (!b) return false; b.click(); return true })()`
    )
    await wait(1400)
    await shoot('player')
    await run<boolean>(
      `(() => { const b = document.querySelector('.fullplayer__header button'); if (b) b.click(); return true })()`
    )
    await wait(700)

    // ---- поиск: ради рядов карточек, включая плейлисты ----
    await run<boolean>(`(() => {
      const input = document.querySelector('.topbar input')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'ROCK')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const form = input.closest('form')
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      return true
    })()`)
    await wait(4000)
    await run<boolean>(`(() => {
      const box = document.querySelector('.app__content')
      if (!box) return false
      box.scrollTop = box.scrollHeight
      return true
    })()`)
    await wait(1000)
    await shoot('search')

    // ---- настройки: тема и анимации ----
    await run<boolean>(`(${click})('Настройки')`)
    await wait(1400)
    await shoot('settings')

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
      await run(`(() => { const b = document.querySelector('.nowplaying__track'); if (b) b.click(); return true })()`)
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
        `(() => { const b = document.querySelector('.nowplaying__track'); if (!b) return false; b.click(); return true })()`
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
