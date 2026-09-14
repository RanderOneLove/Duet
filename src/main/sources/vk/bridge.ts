import { BrowserWindow, session } from 'electron'

export const VK_PARTITION = 'persist:vk'
const LOGIN_PAGE = 'https://vk.com/login'

export async function isSignedIn(): Promise<boolean> {
  const cookies = await getAuthCookies()
  return cookies !== null
}

export async function signIn(): Promise<void> {
  await clearSession()
  
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 560,
      height: 720,
      title: 'Вход в VK',
      autoHideMenuBar: true,
      webPreferences: { partition: VK_PARTITION, contextIsolation: true, nodeIntegration: false }
    })

    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      if (!win.isDestroyed()) win.destroy()
      if (ok) resolve()
      else reject(new Error('Вход отменён'))
    }

    win.webContents.on('did-navigate', async (_event, url) => {
      if (/^https:\/\/(m\.)?vk\.(com|ru)\//.test(url) && !/\/login|\/join|id\.vk\.com/.test(url)) {
        const cookies = await getAuthCookies()
        if (cookies !== null) {
          finish(true)
        }
      }
    })

    win.on('closed', () => finish(false))
    void win.loadURL(LOGIN_PAGE)
  })
}

export async function clearSession(): Promise<void> {
  await session.fromPartition(VK_PARTITION).clearStorageData()
}

export async function getAuthCookies(): Promise<{ p: string; remixsid: string } | null> {
  const cookies = await session.fromPartition(VK_PARTITION).cookies.get({ domain: '.vk.com' })
  const p = cookies.find((c) => c.name === 'p')?.value
  const remixsid = cookies.find((c) => c.name === 'remixsid')?.value
  
  if (p && remixsid) {
    return { p, remixsid }
  }
  
  // Try without domain filter just in case
  const allCookies = await session.fromPartition(VK_PARTITION).cookies.get({})
  const p2 = allCookies.find((c) => c.name === 'p')?.value
  const remixsid2 = allCookies.find((c) => c.name === 'remixsid')?.value
  if (p2 && remixsid2) {
    return { p: p2, remixsid: remixsid2 }
  }
  
  return null
}
