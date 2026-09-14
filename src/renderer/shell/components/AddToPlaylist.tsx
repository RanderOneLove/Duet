import { useState } from 'react'
import type { Playlist, Track } from '@shared/domain'

interface Props {
  /** What to put in, or empty to only create the playlist. */
  tracks: Track[]
  playlists: Playlist[]
  label: string
  className?: string
}

/**
 * Putting tracks into a playlist of our own. A local playlist is the only place
 * the two services can sit in one list, so this is the one control that offers
 * both an existing list and a new one in the same breath.
 */
export function AddToPlaylist({ tracks, playlists, label, className = '' }: Props): JSX.Element {
  const [naming, setNaming] = useState(false)
  const [title, setTitle] = useState('')
  const [done, setDone] = useState('')

  const local = playlists.filter((playlist) => playlist.service === null)

  const finish = (message: string): void => {
    setDone(message)
    setNaming(false)
    setTitle('')
    // Long enough to read, short enough not to linger over the next action.
    setTimeout(() => setDone(''), 2600)
  }

  if (done) return <span className={`muted addto__done ${className}`}>{done}</span>

  if (naming) {
    return (
      <span className={`addto ${className}`}>
        <input
          autoFocus
          placeholder="Название плейлиста"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setNaming(false)
            if (event.key !== 'Enter' || !title.trim()) return
            void window.shell.createPlaylist(title, tracks).then(() => finish('Создан'))
          }}
        />
        <button
          className="pill pill--sm"
          disabled={!title.trim()}
          onClick={() => void window.shell.createPlaylist(title, tracks).then(() => finish('Создан'))}
        >
          Создать
        </button>
        <button className="pill pill--outline pill--sm" onClick={() => setNaming(false)}>
          Отмена
        </button>
      </span>
    )
  }

  return (
    <label className={`picker ${className}`}>
      <select
        value=""
        onChange={(event) => {
          const value = event.target.value
          if (value === 'new') {
            setNaming(true)
            return
          }
          const target = local.find((playlist) => playlist.nativeId === value)
          if (!target) return
          void window.shell
            .addToPlaylist(value, tracks)
            .then(() => finish(`В «${target.title}»`))
        }}
      >
        <option value="" disabled>
          {label}
        </option>
        {local.map((playlist) => (
          <option key={playlist.nativeId} value={playlist.nativeId}>
            {playlist.title} · {playlist.trackCount}
          </option>
        ))}
        <option value="new">Новый плейлист…</option>
      </select>
    </label>
  )
}
