import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { Settings } from '@shared/types'
import type { PlayerCommand, PlayerState, PlayerUpdate } from '@shared/player'

/** The mini player's surface: read the player state, send transport. */
const api = {
  getPlayer: (): Promise<PlayerState> => ipcRenderer.invoke(IPC.playerGet),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),

  command: (input: PlayerCommand): void => ipcRenderer.send(IPC.playerCommand, input),
  /**
   * Report the measured content size. The window is transparent and frameless,
   * so it must match the content exactly or it swallows clicks meant for the
   * app underneath.
   */
  resize: (width: number, height: number): void => ipcRenderer.send(IPC.miniResize, { width, height }),
  close: (): void => ipcRenderer.send(IPC.miniToggle),
  restoreMain: (): void => ipcRenderer.send(IPC.miniRestoreMain),

  onPlayer: (handler: (state: PlayerUpdate) => void) => subscribe(IPC.playerState, handler),
  /** Hover comes from the main process — drag regions swallow DOM mouse events. */
  onHover: (handler: (hovered: boolean) => void) => subscribe(IPC.miniHover, handler),
  onSettings: (handler: (settings: Settings) => void) => subscribe(IPC.settingsChanged, handler)
}

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('mini', api)

export type MiniApi = typeof api
