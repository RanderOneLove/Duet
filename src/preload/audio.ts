import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'

export interface AudioLoad {
  url: string
  positionMs: number
  volume: number
  muted: boolean
  autoplay: boolean
}

export type AudioControl =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; positionMs: number }
  | { type: 'setVolume'; volume: number }
  | { type: 'setMuted'; muted: boolean }
  | { type: 'setSink'; deviceId: string }

export interface AudioOutput {
  id: string
  label: string
}

export interface AudioEvent {
  type: 'progress' | 'playing' | 'paused' | 'ended' | 'ready' | 'error' | 'stalled' | 'devices'
  positionMs?: number
  durationMs?: number
  message?: string
  /** Only on 'devices': what the machine can play through right now. */
  devices?: AudioOutput[]
}

const api = {
  onLoad: (handler: (payload: AudioLoad) => void): void => {
    ipcRenderer.on(IPC.audioLoad, (_event, payload: AudioLoad) => handler(payload))
  },
  onControl: (handler: (command: AudioControl) => void): void => {
    ipcRenderer.on(IPC.audioControl, (_event, command: AudioControl) => handler(command))
  },
  event: (event: AudioEvent): void => ipcRenderer.send(IPC.audioEvent, event)
}

contextBridge.exposeInMainWorld('audioHost', api)

export type AudioHostApi = typeof api
