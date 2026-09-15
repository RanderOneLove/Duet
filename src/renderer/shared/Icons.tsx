/**
 * Inline SVG transport icons. The wireframe uses text glyphs (◀◀ ❚❚ ▶▶) as
 * placeholders; real paths keep the controls crisp at every size.
 */
type Props = { size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true
})

export const Play = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
  </svg>
)

export const Pause = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M7 4h3.2v16H7zm6.8 0H17v16h-3.2z" />
  </svg>
)

export const Next = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M6 5.5v13a1 1 0 0 0 1.55.83L16 13.9V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.1L7.55 4.67A1 1 0 0 0 6 5.5Z" />
  </svg>
)

export const Prev = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M18 5.5v13a1 1 0 0 1-1.55.83L8 13.9V18a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v4.1l8.45-5.43A1 1 0 0 1 18 5.5Z" />
  </svg>
)

export const Volume = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4zM15.4 8.6a4.6 4.6 0 0 1 0 6.8l1.3 1.4a6.5 6.5 0 0 0 0-9.6z" />
  </svg>
)

export const Expand = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 10V4h6v2H6v4zm10-6h6v6h-2V6h-4zm6 10v6h-6v-2h4v-4zM4 14h2v4h4v2H4z" />
  </svg>
)

export const Close = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4zM19 6.4 6.4 19 5 17.6 17.6 5z" />
  </svg>
)

export const Minimize = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M5 11h14v2H5z" />
  </svg>
)

export const Maximize = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M5 5h14v14H5zm2 2v10h10V7z" />
  </svg>
)

export const TrayDown = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3 1.4 1.4L12 17.4l-5.7-5.7 1.4-1.4L11 13.6V4a1 1 0 0 1 1-1ZM5 19h14v2H5z" />
  </svg>
)

export const Search = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M10.5 3a7.5 7.5 0 1 1-4.6 13.4l-2.2 2.2-1.4-1.4 2.2-2.2A7.5 7.5 0 0 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" />
  </svg>
)

export const Home = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 3.2 21 11h-2.6v8.8h-4.6v-5.4h-3.6v5.4H5.6V11H3z" />
  </svg>
)

export const Library = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 4h2.4v16H4zm4.4 0h2.4v16H8.4zM14 4.6l2.3-.6 3.7 14.4-2.3.6z" />
  </svg>
)

export const Gear = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Zm0-2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z" />
    <path d="M13.9 2a.6.6 0 0 1 .59.48l.32 1.66c.5.18.97.45 1.39.79l1.6-.55a.6.6 0 0 1 .71.27l1.9 3.3a.6.6 0 0 1-.12.75l-1.28 1.1a6.6 6.6 0 0 1 0 1.6l1.28 1.1a.6.6 0 0 1 .12.75l-1.9 3.3a.6.6 0 0 1-.71.27l-1.6-.55c-.42.34-.89.6-1.39.79l-.32 1.66a.6.6 0 0 1-.59.48h-3.8a.6.6 0 0 1-.59-.48l-.32-1.66a6.6 6.6 0 0 1-1.39-.79l-1.6.55a.6.6 0 0 1-.71-.27l-1.9-3.3a.6.6 0 0 1 .12-.75l1.28-1.1a6.6 6.6 0 0 1 0-1.6l-1.28-1.1a.6.6 0 0 1-.12-.75l1.9-3.3a.6.6 0 0 1 .71-.27l1.6.55c.42-.34.89-.6 1.39-.79l.32-1.66A.6.6 0 0 1 10.1 2Zm-.5 2h-2.8l-.28 1.45a.6.6 0 0 1-.42.46c-.6.18-1.15.5-1.6.93a.6.6 0 0 1-.61.13l-1.4-.48-1.4 2.42 1.12.96a.6.6 0 0 1 .2.58 4.7 4.7 0 0 0 0 1.9.6.6 0 0 1-.2.58l-1.12.96 1.4 2.42 1.4-.48a.6.6 0 0 1 .61.13c.45.43 1 .75 1.6.93a.6.6 0 0 1 .42.46L10.6 20h2.8l.28-1.45a.6.6 0 0 1 .42-.46c.6-.18 1.15-.5 1.6-.93a.6.6 0 0 1 .61-.13l1.4.48 1.4-2.42-1.12-.96a.6.6 0 0 1-.2-.58 4.7 4.7 0 0 0 0-1.9.6.6 0 0 1 .2-.58l1.12-.96-1.4-2.42-1.4.48a.6.6 0 0 1-.61-.13 4.6 4.6 0 0 0-1.6-.93.6.6 0 0 1-.42-.46Z" />
  </svg>
)

export const Back = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M15.4 4.6 8 12l7.4 7.4 1.4-1.4L10.8 12l6-6z" />
  </svg>
)

export const Forward = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M8.6 4.6 16 12l-7.4 7.4-1.4-1.4 6-6-6-6z" />
  </svg>
)

export const Shuffle = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M14.8 5.2 17 7.4h-1.9c-1 0-1.9.5-2.5 1.3l-4 5.6c-.4.6-1.1.9-1.8.9H4v-2h2.8c.3 0 .6-.1.8-.4l4-5.6c.9-1.3 2.4-2 4-2H17l-2.2-2.2zM4 6.8h2.8c1.1 0 2.1.5 2.8 1.4l.5.7-1.2 1.7-.8-1.2a1.5 1.5 0 0 0-1.3-.6H4zm10 6.5 1.4 1.4-.6.6h2.2l-2.2 2.2 1.4 1.4L20 16 16.2 12.2z" />
    <path d="M13.3 14.1c.6.8 1.5 1.3 2.5 1.3H17v-2h-1.2c-.4 0-.7-.2-.9-.5l-.5-.7z" />
  </svg>
)

export const Repeat = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M7 5h9.6l-1.8-1.8L16.2 1.8 20.4 6l-4.2 4.2-1.4-1.4L16.6 7H7a2 2 0 0 0-2 2v3H3V9a4 4 0 0 1 4-4Zm10 14H7.4l1.8 1.8-1.4 1.4L3.6 18l4.2-4.2 1.4 1.4L7.4 17H17a2 2 0 0 0 2-2v-3h2v3a4 4 0 0 1-4 4Z" />
  </svg>
)

export const RepeatOne = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M7 5h9.6l-1.8-1.8L16.2 1.8 20.4 6l-4.2 4.2-1.4-1.4L16.6 7H7a2 2 0 0 0-2 2v3H3V9a4 4 0 0 1 4-4Zm10 14H7.4l1.8 1.8-1.4 1.4L3.6 18l4.2-4.2 1.4 1.4L7.4 17H17a2 2 0 0 0 2-2v-3h2v3a4 4 0 0 1-4 4Z" />
    <path d="M11.4 9.6h1.4v5h-1.4v-3.6l-1 .5-.4-1.2z" />
  </svg>
)

export const Heart = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 20.3 10.6 19C5.4 14.3 2 11.3 2 7.6A4.6 4.6 0 0 1 6.6 3c1.6 0 3.1.7 4.1 1.9L12 6.2l1.3-1.3A5.4 5.4 0 0 1 17.4 3 4.6 4.6 0 0 1 22 7.6c0 3.7-3.4 6.7-8.6 11.4z" />
  </svg>
)

/**
 * The Duet mark: two overlapping circles. Colours are fixed rather than
 * tokenised — it is a logo, not a themed control.
 */
export const DuetMark = ({ size = 24 }: Props) => (
  <svg
    width={size}
    height={Math.round((size * 80) / 115)}
    viewBox="0 0 115 80"
    fill="none"
    aria-hidden={true}
  >
    <defs>
      <clipPath id="duet-mark-left">
        <circle cx="40" cy="40" r="40" />
      </clipPath>
    </defs>
    <circle cx="40" cy="40" r="40" fill="#4A6CF7" />
    <circle cx="75" cy="40" r="40" fill="#E9E9ED" />
    <g clipPath="url(#duet-mark-left)">
      <circle cx="75" cy="40" r="40" fill="#8F9DF5" />
    </g>
  </svg>
)

export const Collapse = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 4h2v16H4zm12.6 3.4L12 12l4.6 4.6-1.4 1.4L9.2 12l6-6z" />
  </svg>
)

export const Expand2 = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 4h2v16H4zM8.8 7.4 10.2 6l6 6-6 6-1.4-1.4L13.4 12z" />
  </svg>
)

export const Download = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 3a1 1 0 0 1 1 1v8.6l3-3 1.4 1.4L12 16.4l-5.4-5.4L8 9.6l3 3V4a1 1 0 0 1 1-1ZM5 18h14v2H5z" />
  </svg>
)

export const Check = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M9.6 16.2 5.4 12l-1.4 1.4 5.6 5.6L20.4 8.2 19 6.8z" />
  </svg>
)

export const Timer = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M9 2h6v2H9zm2 5h2v6l4 2-.9 1.8L11 14zM12 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14" />
  </svg>
)

export const PlaylistAdd = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 5h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4h2v4h4v2h-4v4h-2v-4h-4v-2h4z" />
  </svg>
)

export const Speaker = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m5 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 6a5 5 0 1 0 0 10 5 5 0 0 0 0-10m0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6" />
  </svg>
)

/** A four-point sparkle: "find me more like this". */
export const Sparkle = ({ size = 14 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 2.5 13.9 8a4 4 0 0 0 2.6 2.6L22 12.5l-5.5 1.9A4 4 0 0 0 13.9 17L12 22.5 10.1 17a4 4 0 0 0-2.6-2.6L2 12.5l5.5-1.9A4 4 0 0 0 10.1 8zM19 3l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
  </svg>
)
