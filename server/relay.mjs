import { createServer } from 'node:http'

/**
 * Ретранслятор совместного прослушивания.
 *
 * Аудио через него не идёт и не может идти: каждый слушает из своего
 * аккаунта, а здесь передаётся только «какой трек и с какой секунды».
 * Поэтому хранить нечего — всё живёт в памяти и исчезает вместе с сессией.
 *
 *   POST /s/<код>   — ведущий публикует состояние (нужен заголовок X-Duet-Key)
 *   GET  /s/<код>   — ведомый держит поток событий и получает обновления
 *   GET  /healthz   — жив ли процесс
 *
 * Ставится за nginx с TLS: см. README рядом.
 */

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'

/** Разумные потолки: это не публичный сервис, а ретранслятор для своих. */
const MAX_BODY = 8 * 1024
const MAX_SESSIONS = 500
const MAX_FOLLOWERS = 50
/** Сессия без вестей от ведущего считается брошенной. */
const SESSION_TTL_MS = 5 * 60 * 1000
/** Комментарий в поток, чтобы прокси не закрыл его как молчащий. */
const HEARTBEAT_MS = 20_000

const CODE = /^[A-Za-z0-9_-]{8,64}$/

/** @type {Map<string, {key: string, state: unknown, at: number, followers: Set<import('node:http').ServerResponse>}>} */
const sessions = new Map()

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')

  if (url.pathname === '/healthz') {
    return send(response, 200, { ok: true, sessions: sessions.size })
  }

  const match = /^\/s\/([A-Za-z0-9_-]+)$/.exec(url.pathname)
  if (!match || !CODE.test(match[1])) return send(response, 404, { error: 'not found' })
  const code = match[1]

  if (request.method === 'POST') return publish(request, response, code)
  if (request.method === 'GET') return follow(request, response, code)
  return send(response, 405, { error: 'method not allowed' })
})

/** Ведущий шлёт, что у него играет. */
function publish(request, response, code) {
  const key = request.headers['x-duet-key']
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
    return send(response, 400, { error: 'bad key' })
  }

  const existing = sessions.get(code)
  // Ключ выдаётся первой публикацией: без него посторонний, узнавший код из
  // ссылки, мог бы подменять ведущего в его же сессии.
  if (existing && existing.key !== key) return send(response, 403, { error: 'not the host' })
  if (!existing && sessions.size >= MAX_SESSIONS) return send(response, 503, { error: 'busy' })

  let body = ''
  let tooBig = false
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > MAX_BODY) {
      tooBig = true
      request.destroy()
    }
  })
  request.on('end', () => {
    if (tooBig) return send(response, 413, { error: 'too large' })

    let state
    try {
      state = JSON.parse(body)
    } catch {
      return send(response, 400, { error: 'bad json' })
    }

    const session = existing ?? { key, state: null, at: 0, followers: new Set() }
    session.state = state
    session.at = Date.now()
    sessions.set(code, session)

    const line = `data: ${JSON.stringify(state)}\n\n`
    for (const follower of session.followers) follower.write(line)
    send(response, 200, { followers: session.followers.size })
  })
}

/** Ведомый держит открытый поток и получает каждое обновление. */
function follow(request, response, code) {
  const session = sessions.get(code)
  if (!session) return send(response, 404, { error: 'no session' })
  if (session.followers.size >= MAX_FOLLOWERS) return send(response, 503, { error: 'full' })

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Про запас, если однажды поток понадобится странице в браузере.
    'Access-Control-Allow-Origin': '*'
  })

  session.followers.add(response)
  // Догоняем сразу: иначе ведомый ждал бы следующей смены трека.
  if (session.state) response.write(`data: ${JSON.stringify(session.state)}\n\n`)

  const beat = setInterval(() => response.write(': ping\n\n'), HEARTBEAT_MS)
  const stop = () => {
    clearInterval(beat)
    session.followers.delete(response)
  }
  request.on('close', stop)
  request.on('error', stop)
}

function send(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  })
  response.end(text)
}

/** Брошенные сессии убираются сами — иначе память растёт вечно. */
setInterval(() => {
  const deadline = Date.now() - SESSION_TTL_MS
  for (const [code, session] of sessions) {
    if (session.at > deadline) continue
    for (const follower of session.followers) {
      follower.write('event: ended\ndata: {}\n\n')
      follower.end()
    }
    sessions.delete(code)
  }
}, 30_000).unref()

server.listen(PORT, HOST, () => {
  console.log(`duet-relay слушает http://${HOST}:${PORT}`)
})
