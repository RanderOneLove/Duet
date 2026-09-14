import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@toil/vk-audio'] })],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        // One preload per window: the app shell, the mini player, and the
        // hidden host that owns the media element.
        input: {
          shell: resolve('src/preload/shell.ts'),
          mini: resolve('src/preload/mini.ts'),
          audio: resolve('src/preload/audio.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@ui': resolve('src/renderer/shared')
      }
    },
    server: {
      host: '127.0.0.1'
    },
    build: {
      rollupOptions: {
        input: {
          shell: resolve('src/renderer/shell/index.html'),
          mini: resolve('src/renderer/mini/index.html'),
          audio: resolve('src/renderer/audio/index.html')
        }
      }
    }
  }
})
