import Store from 'electron-store'
import { DEFAULT_HOME_BLOCKS, DEFAULT_SETTINGS, type Settings } from '@shared/types'

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
  /*
   * Список блоков Главной мог быть записан прежней версией — без «Скачанного»
   * или, наоборот, с пунктом, которого больше нет. Тогда экран показывал бы
   * блок, у которого в настройках нет тумблера: выключить его было бы нечем.
   * Поэтому порядок берём из сохранённого, а состав — из нынешнего.
   */
  const saved = Array.isArray(settings.homeBlocks) ? settings.homeBlocks : []
  const seen = new Set<string>()
  settings.homeBlocks = [
    ...saved.filter((block) => {
      // Дубль в списке означал бы блок, нарисованный дважды, причём видимость
      // читалась бы у первой записи, а переключалась у обеих.
      if (seen.has(block.id)) return false
      if (!DEFAULT_HOME_BLOCKS.some((known) => known.id === block.id)) return false
      seen.add(block.id)
      return true
    }),
    ...DEFAULT_HOME_BLOCKS.filter((known) => !seen.has(known.id))
  ]

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
