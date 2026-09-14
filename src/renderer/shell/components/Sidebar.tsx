import type { Playlist } from '@shared/domain'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { Collapse, Download, DuetMark, Expand2, Gear, Heart, Home, Library, Search } from '../../shared/Icons'

export type Route = 'home' | 'search' | 'library' | 'liked' | 'downloads' | 'settings'

const NAV: { id: Route; label: string; icon: () => JSX.Element }[] = [
  { id: 'home', label: 'Главная', icon: () => <Home size={15} /> },
  { id: 'search', label: 'Поиск', icon: () => <Search size={15} /> },
  { id: 'library', label: 'Моя коллекция', icon: () => <Library size={15} /> },
  { id: 'liked', label: 'Вам нравится', icon: () => <Heart size={15} /> },
  { id: 'downloads', label: 'Загрузки', icon: () => <Download size={15} /> }
]

interface Props {
  route: Route
  playlists: Playlist[]
  collapsed: boolean
  onNavigate: (route: Route) => void
  onOpenPlaylist: (playlist: Playlist) => void
  onToggleCollapsed: () => void
}

/**
 * Wireframe 2a's sidebar. Collapsed it keeps only the icons, so the content
 * column gets the width back — every row keeps a `title` so the meaning
 * survives the labels disappearing.
 */
export function Sidebar({
  route,
  playlists,
  collapsed,
  onNavigate,
  onOpenPlaylist,
  onToggleCollapsed
}: Props): JSX.Element {
  return (
    <nav className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar__brand drag">
        <DuetMark size={collapsed ? 24 : 30} />
        {!collapsed && <span className="sidebar__title">Duet</span>}
        <button
          className="sidebar__collapse nodrag"
          title={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <Expand2 size={13} /> : <Collapse size={13} />}
        </button>
      </div>

      {NAV.map((item) => (
        <button
          key={item.id}
          className="navitem"
          title={item.label}
          aria-current={route === item.id ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
        >
          {item.icon()}
          {!collapsed && item.label}
        </button>
      ))}

      {playlists.length > 0 && !collapsed && (
        <>
          <div className="sidebar__label muted">ПЛЕЙЛИСТЫ</div>
          <div className="sidebar__playlists">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                className="navitem navitem--sm"
                title={playlist.title}
                onClick={() => onOpenPlaylist(playlist)}
              >
                <span className="truncate">{playlist.title}</span>
                <ServiceBadge service={playlist.service} className="sidebar__badge" />
              </button>
            ))}
          </div>
        </>
      )}

      <div className="sidebar__spacer" />

      <button
        className="navitem"
        title="Настройки"
        aria-current={route === 'settings' ? 'page' : undefined}
        onClick={() => onNavigate('settings')}
      >
        <Gear size={15} />
        {!collapsed && 'Настройки'}
      </button>
    </nav>
  )
}
