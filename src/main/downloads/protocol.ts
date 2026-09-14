import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { downloadsFolder } from './manager'

/**
 * Local files are served over a private scheme rather than `file://`: the audio
 * host runs from http://localhost in development, and a file: URL there is
 * blocked outright. One scheme works in both builds.
 */
export const MEDIA_SCHEME = 'duet'

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    }
  ])
}

export function serveMediaScheme(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'media') return new Response('', { status: 404 })

    const file = resolve(decodeURIComponent(url.pathname.replace(/^\//, '')))
    // Only ever serve out of our own downloads folder.
    if (!file.startsWith(resolve(downloadsFolder()))) return new Response('', { status: 403 })

    return net.fetch(pathToFileURL(file).toString(), { headers: request.headers })
  })
}

export function mediaUrl(file: string): string {
  return `${MEDIA_SCHEME}://media/${encodeURIComponent(file)}`
}
