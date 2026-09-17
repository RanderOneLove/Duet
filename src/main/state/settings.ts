import Store from 'electron-store'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

const store = new Store<Settings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS
})

type Listener = (settings: Settings) => void
const listeners = new Set<Listener>()

/**
 * Собранные настройки. Их спрашивают на каждом тике позиции — из движка, из
 * трея, из публикации совместного прослушивания, — а сборка означала чтение
 * хранилища и склейку объекта поверх умолчаний по четыре раза в секунду.
 * Файл меняем только мы, так что достаточно пересобирать его при записи.
 */
let cached: Settings | null = null

export function getSettings(): Settings {
  if (cached) return cached

  // Spread over the defaults so a settings file written by an older version
  // still yields every key the app expects.
  const stored = store.store as Partial<Settings> & { miniOnMinimize?: boolean }
  const settings = { ...DEFAULT_SETTINGS, ...stored }

  // Выключатель «показывать при сворачивании» стал выбором из трёх. Тот, кто
  // его выключил, не должен обнаружить мини-плеер снова.
  if (stored.miniShowWhen === undefined && stored.miniOnMinimize === false) {
    settings.miniShowWhen = 'never'
  }
  cached = settings
  return settings
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  // Снимок обновляется до записи: слушатели ниже читают настройки сразу же.
  cached = next
  store.set(next)
  for (const listener of listeners) listener(next)
  return next
}

export function onSettingsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
