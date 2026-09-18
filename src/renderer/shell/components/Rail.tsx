import { DuetMark, Download, Gear, Heart, Home, Library, Search } from '../../shared/Icons'

export type Route = 'home' | 'search' | 'library' | 'liked' | 'downloads' | 'settings'

const NAV: { id: Route; label: string; icon: () => JSX.Element }[] = [
  { id: 'home', label: 'Главная', icon: () => <Home size={17} /> },
  { id: 'search', label: 'Поиск', icon: () => <Search size={17} /> },
  { id: 'library', label: 'Моя коллекция', icon: () => <Library size={17} /> },
  { id: 'liked', label: 'Вам нравится', icon: () => <Heart size={17} /> },
  { id: 'downloads', label: 'Загрузки', icon: () => <Download size={17} /> }
]

interface Props {
  route: Route
  onNavigate: (route: Route) => void
}

/**
 * Навигация вайрфрейма v2: колонка в 72 пикселя, одни значки.
 *
 * Подписи и список плейлистов, которые были в прежней панели, убраны нарочно.
 * Панель занимала 214 пикселей ради того, что человек и так знает наизусть, а
 * плейлисты живут в «Моей коллекции» — там их видно все сразу и с обложками,
 * а не столбиком обрезанных названий. Смысл значка не теряется: у каждого есть
 * подсказка, а активный подсвечен плитой.
 */
export function Rail({ route, onNavigate }: Props): JSX.Element {
  return (
    <nav className="rail drag">
      <div className="rail__brand" title="Duet">
        <DuetMark size={26} />
      </div>

      {NAV.map((item) => (
        <button
          key={item.id}
          className="railitem nodrag"
          title={item.label}
          aria-label={item.label}
          aria-current={route === item.id ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
        >
          {item.icon()}
        </button>
      ))}

      <div className="rail__spacer" />

      <button
        className="railitem nodrag"
        title="Настройки"
        aria-label="Настройки"
        aria-current={route === 'settings' ? 'page' : undefined}
        onClick={() => onNavigate('settings')}
      >
        <Gear size={17} />
      </button>
    </nav>
  )
}
