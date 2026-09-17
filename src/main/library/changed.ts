/**
 * «Каталог изменился» — одно событие на всё приложение.
 *
 * Живёт отдельно от реестра источников потому, что подавать его нужно и
 * изнутри самих источников: список лайков, обновившийся в фоне после запуска,
 * должен доехать до экранов так же, как доезжает нажатое сердечко. Импортировать
 * ради этого реестр источники не могут — он импортирует их.
 */

type Listener = () => void
const listeners = new Set<Listener>()

export function onLibraryChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyLibraryChanged(): void {
  for (const listener of listeners) listener()
}

/**
 * Изменился ли список настолько, чтобы перерисовывать экраны. Сравниваются
 * идентификаторы по порядку: переставленный трек — тоже изменение, а тот же
 * список в том же порядке трогать экран не должен.
 */
export function listChanged(before: { id: string }[] | undefined, after: { id: string }[]): boolean {
  if (!before || before.length !== after.length) return true
  for (let i = 0; i < after.length; i += 1) {
    if (before[i]?.id !== after[i]?.id) return true
  }
  return false
}
