import { useState } from 'react'

interface Props {
  url: string | null | undefined
  /** Seeds the placeholder's colours, so each playlist gets its own. */
  seed?: string
  className?: string
  rounded?: boolean
  alt?: string
}

/**
 * Artwork with a real fallback. Services leave plenty of playlists and tracks
 * without a cover, and an empty grey square reads as a loading failure — the
 * placeholder is a tinted Duet mark instead, tinted from the title so a list of
 * coverless playlists still looks like distinct items.
 */
export function Cover({ url, seed = '', className = '', rounded = false, alt = '' }: Props): JSX.Element {
  const [failed, setFailed] = useState(false)

  if (url && !failed) {
    return (
      <img
        className={`art ${rounded ? 'art--round' : ''} ${className}`}
        src={url}
        alt={alt}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }

  const hue = hashHue(seed)
  return (
    <div
      className={`art cover-blank ${rounded ? 'art--round' : ''} ${className}`}
      style={{
        backgroundImage: `linear-gradient(135deg,
          hsl(${hue} 42% 26%),
          hsl(${(hue + 38) % 360} 38% 15%))`
      }}
      aria-hidden={true}
    >
      <svg className="cover-blank__mark" viewBox="0 0 115 80" fill="none">
        <defs>
          <clipPath id={`cover-clip-${hue}`}>
            <circle cx="40" cy="40" r="40" />
          </clipPath>
        </defs>
        <circle cx="40" cy="40" r="40" fill="#ffffff" fillOpacity="0.9" />
        <circle cx="75" cy="40" r="40" fill="#ffffff" fillOpacity="0.35" />
        <g clipPath={`url(#cover-clip-${hue})`}>
          <circle cx="75" cy="40" r="40" fill="#ffffff" fillOpacity="0.62" />
        </g>
      </svg>
    </div>
  )
}

/** Stable hue per title — the same playlist always gets the same colour. */
function hashHue(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}
