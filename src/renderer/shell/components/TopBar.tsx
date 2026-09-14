import { useEffect, useState } from 'react'
import { Close, Maximize, Minimize, Search, TrayDown } from '../../shared/Icons'

interface Props {
  query: string
  error: string | null
  onSearch: (query: string) => void
  onToggleMini: () => void
  onDismissError?: () => void
  onRetry?: () => void
}

/**
 * Top bar: one search box across both services, plus the window controls —
 * the window is frameless, so it has no native ones.
 */
export function TopBar({ query, error, onSearch, onToggleMini, onDismissError, onRetry }: Props): JSX.Element {
  const [text, setText] = useState(query)

  // Keep the box in step when navigation changes the query underneath it.
  useEffect(() => setText(query), [query])

  return (
    <header className="topbar drag">
      <form
        className="topbar__search nodrag"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch(text)
        }}
      >
        <Search size={13} />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Поиск в VK и Яндекс.Музыке"
          spellCheck={false}
        />
      </form>

      <div className="topbar__spacer" />

      {error && (
        <div className="topbar__error nodrag">
          <span className="topbar__error-text truncate">{error}</span>
          {onRetry && (
            <button className="pill pill--outline pill--sm" onClick={onRetry}>
              Retry
            </button>
          )}
          {onDismissError && (
            <button className="topbar__error-close" onClick={onDismissError} title="Скрыть">
              ✕
            </button>
          )}
        </div>
      )}

      <div className="topbar__actions nodrag">
        <button className="pill pill--ghost pill--sm" onClick={onToggleMini}>
          Мини-плеер
        </button>
      </div>

      <div className="wincontrols nodrag">
        <button title="Свернуть" onClick={() => window.shell.minimize()}>
          <Minimize />
        </button>
        <button title="Развернуть" onClick={() => window.shell.maximizeToggle()}>
          <Maximize />
        </button>
        <button title="Свернуть в трей" onClick={() => window.shell.hideToTray()}>
          <TrayDown />
        </button>
        <button className="wincontrols__close" title="Закрыть в трей" onClick={() => window.shell.hideToTray()}>
          <Close />
        </button>
      </div>
    </header>
  )
}
