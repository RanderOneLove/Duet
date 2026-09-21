import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { EMPTY_PLAYER, type PlayerState, type PlayerUpdate } from '@shared/player'

/**
 * Состояние плеера и настройки, как их присылает главный процесс.
 *
 * Плита живёт с очередью из одного трека: ей показывать больше нечего, а
 * перекладывать через IPC тысячи треков в окно размером с ладонь незачем.
 * Поэтому и первый запрос, и все обновления приходят в одном и том же виде —
 * очередь из одного трека и номер ноль.
 *
 * Раньше первый запрос отдавал полное состояние: полную очередь и настоящий
 * номер в ней. Следующее же обновление приносило номер ноль без очереди, ноль
 * ложился на полную очередь — и плита показывала первый трек очереди вместо
 * играющего, пока трек не сменится.
 */
export function useMiniState(): { player: PlayerState; settings: Settings } {
  const [player, setPlayer] = useState<PlayerState>(EMPTY_PLAYER)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  useEffect(() => {
    const apply = (update: PlayerUpdate): void =>
      // Обновление без очереди означает «она не менялась» — оставляем прежнюю.
      setPlayer((prev) => ({ ...update, queue: update.queue ?? prev.queue }))

    void window.mini.getPlayer().then(apply)
    void window.mini.getSettings().then(setSettings)
    const off = [window.mini.onPlayer(apply), window.mini.onSettings(setSettings)]
    return () => off.forEach((unsubscribe) => unsubscribe())
  }, [])

  return { player, settings }
}
