import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { EMPTY_PLAYER, type PlayerState } from '@shared/player'

/** Player state and settings as pushed by the main process. */
export function useMiniState(): { player: PlayerState; settings: Settings } {
  const [player, setPlayer] = useState<PlayerState>(EMPTY_PLAYER)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const repairing = useRef(false)

  useEffect(() => {
    void window.mini.getPlayer().then(setPlayer)
    void window.mini.getSettings().then(setSettings)
    const off = [
      // An update without a queue means it did not change — keep the last one.
      window.mini.onPlayer((update) =>
        setPlayer((prev) => {
          const queue = update.queue ?? prev.queue
          // A queue rides along only when it changed, so a window opened after
          // the last change can be left without one — the clock then ticks
          // against a track the player cannot name. Ask for the full state the
          // first time that shows, and only once.
          if (queue.length === 0 && update.index >= 0 && !repairing.current) {
            repairing.current = true
            void window.mini.getPlayer().then((full) => {
              repairing.current = false
              setPlayer(full)
            })
          }
          return { ...update, queue }
        })
      ),
      window.mini.onSettings(setSettings)
    ]
    return () => off.forEach((unsubscribe) => unsubscribe())
  }, [])

  return { player, settings }
}
