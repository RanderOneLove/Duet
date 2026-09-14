import { createDecipheriv } from 'node:crypto'

/**
 * VK serves audio as AES-128 encrypted HLS: a playlist of MPEG-TS segments
 * where roughly every other one is encrypted (`#EXT-X-KEY:METHOD=NONE` turns
 * encryption off again). hls.js does all of this for playback; for downloads we
 * have to do it ourselves, then demux the transport stream down to the bare
 * audio frames so the file on disk is a normal .mp3 / .aac.
 */

/** Requests from the main process must look like the browser's, or VK stalls. */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Referer: 'https://vk.com/'
}

export interface HlsResult {
  data: Buffer
  /** File extension implied by the audio codec inside the transport stream. */
  extension: 'mp3' | 'aac'
}

export function isHls(url: string): boolean {
  return url.includes('.m3u8')
}

interface Segment {
  url: string
  /** null while `#EXT-X-KEY:METHOD=NONE` is in force. */
  keyUrl: string | null
  /** The media sequence number, which doubles as the AES IV. */
  sequence: number
}

/** Download a playlist end to end and return playable audio bytes. */
export async function downloadHls(
  url: string,
  onProgress: (fraction: number, bytes: number) => void
): Promise<HlsResult> {
  const response = await fetch(url, { headers: BROWSER_HEADERS })
  if (!response.ok) throw new Error(`плейлист недоступен (${response.status})`)
  const segments = parsePlaylist(await response.text(), response.url)
  if (segments.length === 0) throw new Error('пустой плейлист')

  const keys = new Map<string, Buffer>()
  const parts: Buffer[] = []
  let bytes = 0

  for (const [index, segment] of segments.entries()) {
    const segRes = await fetch(segment.url, { headers: BROWSER_HEADERS })
    if (!segRes.ok) throw new Error(`фрагмент ${index + 1} недоступен (${segRes.status})`)
    let chunk: Buffer = Buffer.from(await segRes.arrayBuffer())

    if (segment.keyUrl) {
      let key = keys.get(segment.keyUrl)
      if (!key) {
        const keyRes = await fetch(segment.keyUrl, { headers: BROWSER_HEADERS })
        if (!keyRes.ok) throw new Error(`ключ недоступен (${keyRes.status})`)
        key = Buffer.from(await keyRes.arrayBuffer())
        keys.set(segment.keyUrl, key)
      }
      chunk = decryptSegment(chunk, key, segment.sequence)
    }

    parts.push(chunk)
    bytes += chunk.length
    onProgress((index + 1) / segments.length, bytes)
  }

  return demux(Buffer.concat(parts))
}

function parsePlaylist(text: string, base: string): Segment[] {
  const segments: Segment[] = []
  let keyUrl: string | null = null
  let sequence = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.slice(line.indexOf(':') + 1)) || 0
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = line.slice('#EXT-X-KEY:'.length)
      const method = /METHOD=([^,]+)/.exec(attributes)?.[1]
      if (!method || method === 'NONE') {
        keyUrl = null
      } else if (method === 'AES-128') {
        const uri = /URI="([^"]+)"/.exec(attributes)?.[1]
        if (!uri) throw new Error('в плейлисте нет ссылки на ключ')
        keyUrl = new URL(uri, base).toString()
      } else {
        throw new Error(`неподдерживаемое шифрование (${method})`)
      }
    } else if (!line.startsWith('#')) {
      segments.push({ url: new URL(line, base).toString(), keyUrl, sequence })
      sequence += 1
    }
  }
  return segments
}

/** With no IV in the playlist, HLS defines it as the sequence number. */
function decryptSegment(data: Buffer, key: Buffer, sequence: number): Buffer {
  const iv = Buffer.alloc(16)
  iv.writeUInt32BE(sequence, 12)
  const decipher = createDecipheriv('aes-128-cbc', key, iv)
  decipher.setAutoPadding(false)
  const out = Buffer.concat([decipher.update(data), decipher.final()])
  // The last block is PKCS#7 padded; auto-padding is off so we trim by hand,
  // which keeps a segment whose length is not a clean multiple from throwing.
  const pad = out[out.length - 1] ?? 0
  return pad > 0 && pad <= 16 ? out.subarray(0, out.length - pad) : out
}

// ---- MPEG-TS demuxing ------------------------------------------------------

const PACKET_SIZE = 188
const SYNC_BYTE = 0x47
/** Stream types we can write straight to disk as an elementary stream. */
const AUDIO_TYPES: Record<number, 'mp3' | 'aac'> = { 0x03: 'mp3', 0x04: 'mp3', 0x0f: 'aac' }

/** Pull the audio elementary stream out of a transport stream. */
function demux(ts: Buffer): HlsResult {
  const start = ts.indexOf(SYNC_BYTE)
  if (start < 0) throw new Error('это не транспортный поток')

  let pmtPid = -1
  let audioPid = -1
  let extension: 'mp3' | 'aac' = 'mp3'
  const parts: Buffer[] = []

  for (let offset = start; offset + PACKET_SIZE <= ts.length; offset += PACKET_SIZE) {
    if (ts[offset] !== SYNC_BYTE) {
      // Resynchronise rather than give up; segment joins can be ragged.
      const next = ts.indexOf(SYNC_BYTE, offset + 1)
      if (next < 0) break
      offset = next - PACKET_SIZE
      continue
    }

    const pid = ((ts[offset + 1]! & 0x1f) << 8) | ts[offset + 2]!
    const unitStart = (ts[offset + 1]! & 0x40) !== 0
    const control = (ts[offset + 3]! & 0x30) >> 4
    if (control === 0 || control === 2) continue

    let payload = offset + 4
    if (control === 3) payload += 1 + ts[payload]!
    if (payload >= offset + PACKET_SIZE) continue
    const body = ts.subarray(payload, offset + PACKET_SIZE)

    if (pid === 0 && pmtPid < 0) {
      pmtPid = readPat(body, unitStart)
    } else if (pid === pmtPid && audioPid < 0) {
      const found = readPmt(body, unitStart)
      if (found) {
        audioPid = found.pid
        extension = found.extension
      }
    } else if (pid === audioPid) {
      parts.push(unitStart ? stripPes(body) : body)
    }
  }

  const data = Buffer.concat(parts)
  if (data.length === 0) throw new Error('в потоке не нашлось аудио')
  return { data, extension }
}

function sectionStart(body: Buffer, unitStart: boolean): Buffer | null {
  if (!unitStart) return null
  const pointer = body[0]!
  return body.subarray(1 + pointer)
}

function readPat(body: Buffer, unitStart: boolean): number {
  const section = sectionStart(body, unitStart)
  if (!section || section.length < 13) return -1
  // Skip the section header, then read the first program entry.
  return ((section[10]! & 0x1f) << 8) | section[11]!
}

function readPmt(body: Buffer, unitStart: boolean): { pid: number; extension: 'mp3' | 'aac' } | null {
  const section = sectionStart(body, unitStart)
  if (!section || section.length < 13) return null
  const length = ((section[1]! & 0x0f) << 8) | section[2]!
  const infoLength = ((section[10]! & 0x0f) << 8) | section[11]!
  const end = Math.min(3 + length - 4, section.length)

  for (let i = 12 + infoLength; i + 5 <= end; ) {
    const type = section[i]!
    const pid = ((section[i + 1]! & 0x1f) << 8) | section[i + 2]!
    const esInfo = ((section[i + 3]! & 0x0f) << 8) | section[i + 4]!
    const extension = AUDIO_TYPES[type]
    if (extension) return { pid, extension }
    i += 5 + esInfo
  }
  return null
}

/** Drop the PES header so only the coded audio frames are left. */
function stripPes(body: Buffer): Buffer {
  if (body.length < 9 || body[0] !== 0 || body[1] !== 0 || body[2] !== 1) return body
  return body.subarray(9 + body[8]!)
}
