import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Session tokens, encrypted at rest with the OS keychain/DPAPI via safeStorage.
 * Kept out of settings.json so the settings file stays readable and shareable.
 */

const FILE = join(app.getPath('userData'), 'secrets.bin')

type Bag = Record<string, string>

let cache: Bag | null = null

export function getSecret(key: string): string | null {
  return read()[key] ?? null
}

export function setSecret(key: string, value: string | null): void {
  const bag = read()
  if (value === null) delete bag[key]
  else bag[key] = value
  cache = bag
  write(bag)
}

function read(): Bag {
  if (cache) return cache
  try {
    const raw = readFileSync(FILE)
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    cache = JSON.parse(json) as Bag
  } catch {
    // Missing file, or a keychain that changed under us — start over rather
    // than blocking sign-in on an unreadable blob.
    cache = {}
  }
  return cache
}

function write(bag: Bag): void {
  const json = JSON.stringify(bag)
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, payload)
}
