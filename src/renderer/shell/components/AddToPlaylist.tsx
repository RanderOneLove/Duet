import { useState } from 'react'
import { PlaylistAdd } from '../../shared/Icons'

/**
 * Starting an empty playlist from the library header. Putting tracks into an
 * existing one is the transport's job — see `PlaylistPicker` — so all this has
 * to do is take a name.
 */
export function NewPlaylistButton(): JSX.Element {
  const [naming, setNaming] = useState(false)
  const [title, setTitle] = useState('')

  const create = (): void => {
    if (!title.trim()) return
    void window.shell.createPlaylist(title, [])
    setTitle('')
    setNaming(false)
  }

  if (!naming) {
    return (
      <button className="pill pill--outline pill--sm" onClick={() => setNaming(true)}>
        <PlaylistAdd size={13} /> Новый плейлист
      </button>
    )
  }

  return (
    <span className="addto">
      <input
        autoFocus
        placeholder="Название плейлиста"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') create()
          if (event.key === 'Escape') setNaming(false)
        }}
      />
      <button className="pill pill--sm" disabled={!title.trim()} onClick={create}>
        Создать
      </button>
      <button className="pill pill--outline pill--sm" onClick={() => setNaming(false)}>
        Отмена
      </button>
    </span>
  )
}
