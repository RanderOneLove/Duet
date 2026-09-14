import Store from 'electron-store'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'

const store = new Store<Settings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS
})

type Listener = (settings: Settings) => void
const listeners = new Set<Listener>()

export function getSettings(): Settings {
  // Spread over the defaults so a settings file written by an older version
  // still yields every key the app expects.
  return { ...DEFAULT_SETTINGS, ...(store.store as Partial<Settings>) }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  store.set(next)
  for (const listener of listeners) listener(next)
  return next
}

export function onSettingsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
