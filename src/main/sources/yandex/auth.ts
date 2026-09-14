import { BrowserWindow, session } from 'electron'

/**
 * Sign-in for Яндекс.Музыка.
 *
 * The user authenticates on Yandex's own OAuth page — we never see the
 * password. What comes back is an OAuth access token, which the Music API
 * accepts directly.
 *
 * The client id is the Yandex Music application's own. Yandex does not expose
 * music scopes to third-party applications, so there is no id we could register
 * that would work instead.
 */
const CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d'
const AUTHORIZE_URL = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${CLIENT_ID}`

export const YANDEX_PARTITION = 'persist:yandex'

/**
 * Open the sign-in window and resolve with the access token.
 *
 * The token arrives in the URL fragment of a redirect. Which URL Yandex
 * redirects to is not contractual, so any navigation carrying `access_token`
 * is accepted rather than matching one expected callback.
 */
export function signIn(): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 560,
      height: 720,
      title: 'Вход в Яндекс',
      autoHideMenuBar: true,
      webPreferences: {
        partition: YANDEX_PARTITION,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    let settled = false
    const finish = (token: string | null, error?: string): void => {
      if (settled) return
      settled = true
      if (!win.isDestroyed()) win.destroy()
      if (token) resolve(token)
      else reject(new Error(error ?? 'Вход отменён'))
    }

    const inspect = (url: string): void => {
      const token = extractToken(url)
      if (token) finish(token)
      const denied = /[?#&]error=/.exec(url)
      if (denied) finish(null, 'Яндекс отклонил вход')
    }

    // Cover every way a navigation can happen, including fragment-only changes
    // which fire neither will-navigate nor did-navigate.
    win.webContents.on('will-redirect', (_event, url) => inspect(url))
    win.webContents.on('will-navigate', (_event, url) => inspect(url))
    win.webContents.on('did-navigate', (_event, url) => inspect(url))
    win.webContents.on('did-navigate-in-page', (_event, url) => inspect(url))

    win.on('closed', () => finish(null))
    void win.loadURL(AUTHORIZE_URL)
  })
}

/** Pull `access_token` out of a URL fragment or query string. */
export function extractToken(url: string): string | null {
  const match = /[#&?]access_token=([^&]+)/.exec(url)
  return match ? decodeURIComponent(match[1]) : null
}

/** Drop the Yandex session so the next sign-in starts clean. */
export async function clearSession(): Promise<void> {
  await session.fromPartition(YANDEX_PARTITION).clearStorageData()
}
