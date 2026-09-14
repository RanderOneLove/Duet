import type { ShellApi } from '../../preload/shell'
import type { MiniApi } from '../../preload/mini'
import type { AudioHostApi } from '../../preload/audio'

declare global {
  interface Window {
    shell: ShellApi
    mini: MiniApi
    audioHost: AudioHostApi
  }
}

export {}
