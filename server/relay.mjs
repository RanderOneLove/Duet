import { createServer } from 'node:http'

/**
 * Ретранслятор совместного прослушивания.
 *
 * Аудио через него не идёт и не может идти: каждый слушает из своего
 * аккаунта, а здесь передаётся только «какой трек и с какой секунды».
 * Поэтому хранить нечего — всё живёт в памяти и исчезает вместе с сессией.
 *
 *   POST /s/<код>        — ведущий публикует состояние (заголовок X-Duet-Key)
 *   GET  /s/<код>        — слушатель держит поток и получает обновления
 *   POST /s/<код>/jam    — ведущий заводит или обнуляет пропуск в общую сессию
 *   POST /s/<код>/say    — участник шлёт ведущему просьбу (заголовок X-Duet-Jam)
 *   GET  /s/<код>/inbox  — ведущий слушает просьбы участников (X-Duet-Key)
 *   GET  /healthz        — жив ли процесс
 *
 * Просьбы участников не идут мимо ведущего: он единственный, у кого играет
 * музыка, и единственный, кто меняет очередь. Ретранслятор их только
 * пересылает — так общая сессия не требует ни второго источника правды, ни
 * разбора, кто кого перебил.
 *
 * Ставится за nginx с TLS: см. README рядом.
 */

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'

/** Разумные потолки: это не публичный сервис, а ретранслятор для своих. */
const MAX_BODY = 8 * 1024
const MAX_SESSIONS = 500
const MAX_FOLLOWERS = 50
/** Просьба участника — это один трек или одна кнопка, ей хватает и меньшего. */
const MAX_SAY = 4 * 1024
/**
 * Сколько просьб в минуту принимать от одной сессии. Пропуск знают все, кому
 * дали ссылку, и один расшалившийся не должен заваливать ведущего.
 */
const SAY_PER_MINUTE = 60
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

  const match = /^\/s\/([A-Za-z0-9_-]+)(\/jam|\/say|\/inbox)?$/.exec(url.pathname)
  if (!match || !CODE.test(match[1])) return send(response, 404, { error: 'not found' })
  const code = match[1]
  const tail = match[2] ?? ''

  if (tail === '/jam') {
    if (request.method !== 'POST') return send(response, 405, { error: 'method not allowed' })
    return setJam(request, response, code)
  }
  if (tail === '/say') {
    if (request.method !== 'POST') return send(response, 405, { error: 'method not allowed' })
    return say(request, response, code)
  }
  if (tail === '/inbox') {
    if (request.method !== 'GET') return send(response, 405, { error: 'method not allowed' })
    return inbox(request, response, code)
  }

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

    const session = existing ?? {
      key,
      state: null,
      at: 0,
      followers: new Set(),
      jam: null,
      inbox: new Set(),
      said: 0,
      saidAt: 0
    }
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

/**
 * Ведущий заводит пропуск в общую сессию или обнуляет его.
 *
 * Пропуск — это второй секрет рядом с кодом: код знают все, кому дали ссылку
 * «послушать вместе», а пропуск — только те, кому доверили добавлять треки.
 * Поэтому он и меняется отдельно: раздали не тем — завели новый, старая ссылка
 * перестала работать, а слушатели остались на месте.
 */
function setJam(request, response, code) {
  const session = sessions.get(code)
  if (!session) return send(response, 404, { error: 'no session' })
  if (request.headers['x-duet-key'] !== session.key) {
    return send(response, 403, { error: 'not the host' })
  }

  readBody(request, response, MAX_BODY, (body) => {
    let jam = null
    try {
      const parsed = JSON.parse(body)
      jam = typeof parsed?.jam === 'string' && CODE.test(parsed.jam) ? parsed.jam : null
    } catch {
      return send(response, 400, { error: 'bad json' })
    }

    session.jam = jam
    session.at = Date.now()
    // Обнулили пропуск — участникам больше нечего слушать в своей половине.
    if (!jam) {
      for (const listener of session.inbox) listener.end()
      session.inbox.clear()
    }
    send(response, 200, { jam: Boolean(jam) })
  })
}

/** Участник просит ведущего: добавить трек, переключить, поздороваться. */
function say(request, response, code) {
  const session = sessions.get(code)
  if (!session) return send(response, 404, { error: 'no session' })
  if (!session.jam) return send(response, 403, { error: 'jam closed' })
  if (request.headers['x-duet-jam'] !== session.jam) {
    return send(response, 403, { error: 'bad pass' })
  }

  // Окно на минуту: считаем просьбы и начинаем счёт заново, когда оно прошло.
  const now = Date.now()
  if (now - session.saidAt > 60_000) {
    session.saidAt = now
    session.said = 0
  }
  if (session.said >= SAY_PER_MINUTE) return send(response, 429, { error: 'too many' })
  session.said += 1

  readBody(request, response, MAX_SAY, (body) => {
    let message
    try {
      message = JSON.parse(body)
    } catch {
      return send(response, 400, { error: 'bad json' })
    }
    if (!message || typeof message.type !== 'string') {
      return send(response, 400, { error: 'bad message' })
    }

    // Ведущего может не быть на связи: окно закрыто, приложение перезапускают.
    // Это не ошибка участника, но знать ему полезно — просьба не дошла.
    const line = `data: ${JSON.stringify(message)}\n\n`
    for (const listener of session.inbox) listener.write(line)
    send(response, 200, { delivered: session.inbox.size })
  })
}

/** Ведущий держит поток и получает просьбы участников. */
function inbox(request, response, code) {
  const session = sessions.get(code)
  if (!session) return send(response, 404, { error: 'no session' })
  if (request.headers['x-duet-key'] !== session.key) {
    return send(response, 403, { error: 'not the host' })
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  })

  session.inbox.add(response)
  const beat = setInterval(() => response.write(': ping\n\n'), HEARTBEAT_MS)
  const stop = () => {
    clearInterval(beat)
    session.inbox.delete(response)
  }
  request.on('close', stop)
  request.on('error', stop)
}

/** Собрать тело запроса, не давая ему разрастись. */
function readBody(request, response, limit, done) {
  let body = ''
  let tooBig = false
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > limit) {
      tooBig = true
      request.destroy()
    }
  })
  request.on('end', () => {
    if (tooBig) return send(response, 413, { error: 'too large' })
    done(body)
  })
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
    for (const listener of session.inbox) listener.end()
    sessions.delete(code)
  }
}, 30_000).unref()

server.listen(PORT, HOST, () => {
  console.log(`duet-relay слушает http://${HOST}:${PORT}`)
})
