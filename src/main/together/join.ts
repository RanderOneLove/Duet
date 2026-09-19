import { app } from 'electron'

/**
 * The way into a shared listening session from outside the app.
 *
 * Discord's presence buttons can only open a link, so the chain is: button →
 * a page in a browser → `duet://join/<код>` → Windows launches Duet (or hands
 * the link to the copy already running) → this module turns the argument list
 * back into a code.
 *
 * The code is only recognised here; what to do with it is the relay's job.
 */

const SCHEME = 'duet'
/** Everything the invite needs: who to follow and where to ask. */
// The code must end where the link does: without the boundary an over-long
// code was quietly cut to its first 64 characters and taken for a valid one.
const JOIN = /^duet:\/\/join\/([A-Za-z0-9_-]{1,64})\/?(?:\?jam=([A-Za-z0-9_-]{1,64}))?$/i

/**
 * Приглашение бывает двух видов, и отличает их пропуск в конце ссылки.
 *
 * Без него зовут послушать: гость слышит то же самое и ничем не управляет.
 * С ним зовут участвовать — добавлять треки в общую очередь и переключать.
 */
export interface JoinRequest {
  code: string
  jam: string | null
}

type Listener = (request: JoinRequest) => void
const listeners = new Set<Listener>()

/** Called for a code from the launch arguments and from a second launch. */
export function onJoinRequest(listener: Listener): () => void {
  listeners.add(listener)
  // A link that arrived before anything was listening must not be lost. It is
  // handed over on the next tick rather than at once: a caller writing the
  // ordinary `const off = onJoinRequest(...)` would otherwise be called back
  // before `off` exists.
  if (pending) {
    const request = pending
    pending = null
    queueMicrotask(() => listener(request))
  }
  return () => listeners.delete(listener)
}

let pending: JoinRequest | null = null

/**
 * Claim `duet://` so Windows knows which program opens it. In development
 * this registers the Electron binary rather than an installed Duet.exe, which
 * is expected — the association only becomes the real app once installed.
 */
export function claimJoinScheme(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    // Running from sources: Windows needs the script path to relaunch us.
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [process.argv[1] as string])
    return
  }
  app.setAsDefaultProtocolClient(SCHEME)
}

/** Pull a join code out of a command line, or null when there is none. */
export function joinCodeFrom(argv: readonly string[]): JoinRequest | null {
  for (const argument of argv) {
    const match = JOIN.exec(argument)
    if (match?.[1]) return { code: match[1], jam: match[2] ?? null }
  }
  return null
}

/** Hand a code to whoever is listening, or hold it until someone is. */
export function offerJoinCode(request: JoinRequest | null): void {
  if (!request) return
  if (listeners.size === 0) {
    pending = request
    return
  }
  for (const listener of listeners) listener(request)
}
