import Store from 'electron-store'
import type { Loudness } from '../../preload/audio'

/**
 * Измеренная громкость треков.
 *
 * Ни VK, ни Яндекс не говорят, насколько громко сведена запись, поэтому её
 * меряет сам хост звука — за первые полминуты прослушивания. Запомненная, она
 * даёт выровнять трек с первой секунды в следующий раз, а не подстраиваться
 * на ходу.
 */

interface Saved {
  /** Идентификатор трека → [LUFS, пик], округлённые: точнее не нужно. */
  tracks: Record<string, [number, number]>
}

const store = new Store<Saved>({ name: 'loudness', defaults: { tracks: {} } })

/** Хватает на год-другой прослушивания; старые уходят первыми. */
const LIMIT = 5000
/** Пока не измерено ничего — так звучит обычная современная запись. */
const DEFAULT_LUFS = -9

let tracks: Record<string, [number, number]> | null = null
let typical: number | null = null
let saveTimer: NodeJS.Timeout | null = null

function all(): Record<string, [number, number]> {
  if (!tracks) tracks = { ...store.get('tracks') }
  return tracks
}

export function loudnessOf(trackId: string): Loudness | null {
  const hit = all()[trackId]
  return hit ? { lufs: hit[0], peak: hit[1] } : null
}

export function rememberLoudness(trackId: string, loudness: Loudness): void {
  if (!trackId || !Number.isFinite(loudness.lufs) || !Number.isFinite(loudness.peak)) return
  const map = all()
  // Удалить и вписать заново — так запись встаёт в конец, к самым свежим.
  delete map[trackId]
  map[trackId] = [Math.round(loudness.lufs * 10) / 10, Math.round(loudness.peak * 1000) / 1000]
  const keys = Object.keys(map)
  for (let i = 0; i < keys.length - LIMIT; i += 1) delete map[keys[i]]
  typical = null
  // Пишем не на каждый трек сразу: файл маленький, но диск трогать незачем.
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    store.set('tracks', all())
  }, 5000)
}

/**
 * Чего ждать от трека, который ещё не мерили: медиана того, что слушают.
 * Догадка по своей же музыке ближе к правде, чем общая цифра для всех.
 */
export function typicalLufs(): number {
  if (typical !== null) return typical
  const values = Object.values(all())
    .map((entry) => entry[0])
    .sort((a, b) => a - b)
  typical = values.length >= 5 ? values[Math.floor(values.length / 2)] : DEFAULT_LUFS
  return typical
}

export function flushLoudness(): void {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  store.set('tracks', all())
}
