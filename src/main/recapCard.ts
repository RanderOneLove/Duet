import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, type NativeImage } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { RecapCardFormat, RecapPeriod } from '@shared/recap'
import { getMainWindow } from './windows/mainWindow'

/**
 * Карточка итогов для соцсетей — настоящей картинкой 1080×1920 или 1200×630.
 *
 * Рисует её та же оболочка, что и экран итогов, только в невидимом окне:
 * одна вёрстка на экран и на картинку, шрифты и обложки — те же. Окно
 * говорит, когда всё догрузилось, и тогда снимается.
 *
 * Размер задаётся не окном, а через протокол отладки Chromium. Окно Windows
 * растягивает масштабом экрана и не пускает выше монитора: при 125 %
 * карточка 1080×1920 выходила 1350×1380 и обрезанной снизу.
 */

const SIZE: Record<RecapCardFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  post: { width: 1200, height: 630 }
}

/** Вызов протокола отладки, который не ответил за это время, — сбой, а не ожидание. */
const STEP_TIMEOUT_MS = 20_000

function step<T>(name: string, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`карточка: «${name}» не ответил`)), STEP_TIMEOUT_MS))
  ])
}

/** Самое долгое ожидание обложек: дальше снимаем как есть. */
const READY_TIMEOUT_MS = 15_000

const waiting = new Map<number, () => void>()

export function registerRecapCard(): void {
  ipcMain.on(IPC.recapCardReady, (event) => {
    waiting.get(event.sender.id)?.()
  })
  ipcMain.handle(IPC.recapSave, async (_event, period: RecapPeriod, format: RecapCardFormat) => {
    const image = await renderCard(period, format)
    const owner = getMainWindow()
    const name = period.kind === 'year' ? `Duet — итоги ${period.year}` : `Duet — итоги ${period.year}-${String(period.month).padStart(2, '0')}`
    const options = {
      title: 'Сохранить картинку',
      defaultPath: `${name}${format === 'post' ? ' (пост)' : ''}.png`,
      filters: [{ name: 'Картинка PNG', extensions: ['png'] }]
    }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, image.toPNG())
    return true
  })
  ipcMain.handle(IPC.recapCopy, async (_event, period: RecapPeriod, format: RecapCardFormat) => {
    clipboard.writeImage(await renderCard(period, format))
    return true
  })
}

export async function renderCard(period: RecapPeriod, format: RecapCardFormat): Promise<NativeImage> {
  const { width, height } = SIZE[format]
  /*
   * Окно показывается, но за краем экрана и без значка на панели задач:
   * совсем скрытое Chromium не рисует, и снимок ждал кадра вечно.
   */
  const win = new BrowserWindow({
    show: false,
    x: -32000,
    y: -32000,
    width: 400,
    height: 400,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#0b0b0d',
    webPreferences: {
      preload: join(__dirname, '../preload/shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Невидимое окно иначе притормаживает отрисовку — снимать было бы нечего.
      // Внеэкранная отрисовка (offscreen) с подменой размера роняла процесс.
      backgroundThrottling: false
    }
  })
  const devtools = win.webContents.debugger

  try {
    devtools.attach('1.3')
    const ready = new Promise<void>((resolve) => {
      waiting.set(win.webContents.id, resolve)
      setTimeout(resolve, READY_TIMEOUT_MS)
    })
    const query = new URLSearchParams({ card: format, period: JSON.stringify(period) }).toString()
    const devServer = process.env['ELECTRON_RENDERER_URL']
    if (devServer) await win.loadURL(`${devServer}/shell/index.html?${query}`)
    else await win.loadFile(join(__dirname, '../renderer/shell/index.html'), { search: query })
    win.showInactive()
    // Размер — после загрузки: подменённый до неё, он ронял процесс.
    await step(
      'размер',
      devtools.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    )
    await ready
    const shot = (await step(
      'снимок',
      devtools.sendCommand('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width, height, scale: 1 },
        captureBeyondViewport: true
      })
    )) as { data: string }
    return nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'))
  } finally {
    if (devtools.isAttached()) devtools.detach()
    waiting.delete(win.webContents.id)
    win.destroy()
  }
}
