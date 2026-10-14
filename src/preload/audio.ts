import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { PlayerCommand } from '@shared/player'

/** Громкость записи: интегральная по EBU R128 и пик сэмплов, 0..1. */
export interface Loudness {
  lufs: number
  peak: number
}

/** То, что Windows показывает на своей плашке с музыкой. */
export interface AudioMeta {
  title: string
  artist: string
  album: string
  artwork: string | null
}

export interface AudioLoad {
  url: string
  positionMs: number
  volume: number
  muted: boolean
  autoplay: boolean
  /** Идентификатор трека: под ним хранится измеренная громкость. */
  key: string
  meta: AudioMeta
  /** Измеренная раньше громкость этого трека, если она есть. */
  loudness: Loudness | null
  /** Чего ждать от трека, который ещё не мерили, — обычная громкость слушаемого. */
  typicalLufs: number
  /**
   * Сменить трек плавно: прежний доигрывает, затихая, пока новый нарастает.
   * Так приходит следующий трек после 'nearEnd'.
   */
  crossfade?: boolean
}

export type AudioControl =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; positionMs: number }
  | { type: 'setVolume'; volume: number }
  | { type: 'setMuted'; muted: boolean }
  | { type: 'setSink'; deviceId: string }
  /**
   * Начать буферизовать то, что заиграет следующим. Ничего не проигрывает:
   * когда этот же url придёт обычной загрузкой, он уже будет наготове.
   */
  | { type: 'preload'; url: string; key: string; loudness: Loudness | null }
  /** Выравнивание громкости и длина кроссфейда; 0 — без кроссфейда. */
  | { type: 'setProcessing'; normalize: boolean; crossfadeMs: number }

export interface AudioOutput {
  id: string
  label: string
}

export interface AudioEvent {
  type:
    | 'progress'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'ready'
    | 'error'
    | 'stalled'
    | 'devices'
    /** До конца трека осталось столько, сколько длится кроссфейд. */
    | 'nearEnd'
    /** Громкость трека измерена — её стоит запомнить. */
    | 'loudness'
  positionMs?: number
  durationMs?: number
  message?: string
  /** Only on 'devices': what the machine can play through right now. */
  devices?: AudioOutput[]
  /** Only on 'loudness'. */
  key?: string
  loudness?: Loudness
}

const api = {
  onLoad: (handler: (payload: AudioLoad) => void): void => {
    ipcRenderer.on(IPC.audioLoad, (_event, payload: AudioLoad) => handler(payload))
  },
  onControl: (handler: (command: AudioControl) => void): void => {
    ipcRenderer.on(IPC.audioControl, (_event, command: AudioControl) => handler(command))
  },
  event: (event: AudioEvent): void => ipcRenderer.send(IPC.audioEvent, event),
  /** Кнопка системы — плашки Windows, гарнитуры — превращается в команду плеера. */
  action: (command: PlayerCommand): void => ipcRenderer.send(IPC.audioAction, command)
}

contextBridge.exposeInMainWorld('audioHost', api)

export type AudioHostApi = typeof api
