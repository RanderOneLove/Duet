/**
 * Цвет акцента: разбор, производные оттенки и подбор по обложке.
 *
 * В токенах акцент — это не один цвет, а четыре: сама заливка, наведение,
 * свечение и мягкая подложка. Поэтому из выбранного человеком `#rrggbb` их
 * надо вывести, а не просить выбирать каждый.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1]!, 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

export function rgbToHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === red) h = ((green - blue) / delta) % 6
    else if (max === green) h = (blue - red) / delta + 2
    else h = (red - green) / delta + 4
  }
  h = (h * 60 + 360) % 360

  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/**
 * Превратить один цвет в набор, которым пользуются стили.
 *
 * Наведение — тот же цвет чуть светлее, свечение и подложка — он же с малой
 * непрозрачностью. Так любой выбранный цвет ведёт себя как родной, а не как
 * заплатка поверх синего.
 */
export function accentTokens(hex: string): Record<string, string> {
  const rgb = parseHex(hex)
  if (!rgb) return {}
  const { h, s, v } = rgbToHsv(rgb)
  const hover = toHex(hsvToRgb(h, Math.max(0, s - 0.12), Math.min(1, v + 0.12)))
  const { r, g, b } = rgb

  return {
    '--accent': hex,
    '--accent-hover': hover,
    '--accent-glow': `rgba(${r}, ${g}, ${b}, 0.4)`,
    '--accent-soft': `rgba(${r}, ${g}, ${b}, 0.16)`
  }
}

/**
 * Взять цвет с обложки.
 *
 * Картинка ужимается до крошечного размера и усредняется по пикселям, но не
 * по всем: серые и слишком тёмные не в счёт — иначе с любой обложки выходил бы
 * один и тот же бурый. Из того, что осталось, берётся самый насыщенный тон и
 * поднимается до пригодного для подписи.
 */
export async function accentFromImage(url: string): Promise<string | null> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
  })
  image.src = url
  if (!(await loaded)) return null

  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  try {
    context.drawImage(image, 0, 0, size, size)
    const { data } = context.getImageData(0, 0, size, size)

    let best: { h: number; s: number; v: number } | null = null
    let bestScore = 0
    for (let i = 0; i < data.length; i += 4) {
      const rgb = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }
      const hsv = rgbToHsv(rgb)
      // Серое и совсем тёмное акцентом быть не может.
      if (hsv.s < 0.25 || hsv.v < 0.2) continue
      const score = hsv.s * hsv.v
      if (score > bestScore) {
        bestScore = score
        best = hsv
      }
    }

    if (!best) return null
    // Подпись поверх акцента белая, поэтому цвет доводится до читаемого.
    return toHex(hsvToRgb(best.h, Math.max(0.55, Math.min(0.95, best.s)), Math.max(0.6, best.v)))
  } catch {
    // Обложка с чужого домена без CORS — холст становится «нечистым».
    return null
  }
}
