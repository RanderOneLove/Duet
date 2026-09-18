import { useEffect, useState } from 'react'
import type { ServiceFilter } from '../useServiceFilter'
import type { UpdateState } from '@shared/updates'
import { Close, Maximize, Minimize, Search, TrayDown, Update } from '../../shared/Icons'
import { Segmented } from './Segmented'

interface Props {
  query: string
  error: string | null
  /** Состояние обновления: по нему появляется кнопка «Обновить». */
  update: UpdateState
  /** Какой сервис показывать — фильтр общий на всё окно. */
  filter: ServiceFilter
  onFilter: (filter: ServiceFilter) => void
  onSearch: (query: string) => void
  onToggleMini: () => void
  onDismissError?: () => void
  onRetry?: () => void
}

/**
 * Титульная строка вайрфрейма v2: поиск, фильтр сервиса и кнопки окна.
 *
 * Фильтр переехал сюда из экранов. Он и раньше означал одно и то же на Главной
 * и в «Вам нравится», но жил в каждом экране своей жизнью: переключив его в
 * одном месте, человек находил другой в другом. Наверху он один на всё окно.
 *
 * Окно у нас без системной рамки, поэтому кнопки управления — свои.
 */
export function TopBar({
  query,
  error,
  update,
  filter,
  onFilter,
  onSearch,
  onToggleMini,
  onDismissError,
  onRetry
}: Props): JSX.Element {
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
        <Search size={14} />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Искать в VK и Яндекс.Музыке"
          spellCheck={false}
        />
        {/* Подсказка про горячую клавишу, как в макете. */}
        <kbd className="topbar__kbd">Ctrl K</kbd>
      </form>

      <div className="topbar__spacer" />

      {error && (
        <div className="topbar__error nodrag">
          <span className="topbar__error-text truncate">{error}</span>
          {onRetry && (
            <button className="pill pill--outline pill--sm" onClick={onRetry}>
              Ещё раз
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
        {/*
          Кнопка появляется, только когда обновление скачано и ждёт установки.
          Пока оно качается, нажимать нечего, а место в строке не бесконечное;
          ход скачивания видно в «О программе», куда за этим и ходят.
        */}
        {update.phase === 'ready' && (
          <button
            className="pill pill--sm topbar__update"
            title={`Перезапустить и поставить версию ${update.version ?? ''}`}
            onClick={() => void window.shell.installUpdate()}
          >
            <Update size={13} /> Обновить
          </button>
        )}

        <Segmented
          value={filter}
          onChange={onFilter}
          options={[
            { id: 'all', label: 'Все' },
            { id: 'vk', label: 'VK' },
            { id: 'yandex', label: 'Яндекс' }
          ]}
        />
        <button className="gbtn" onClick={onToggleMini}>
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
