/**
 * The practice setup the user builds up (map pool, lineups, presets, history). It lives entirely
 * on this PC: the renderer owns its contents and the main process only stores them, so the only
 * thing checked here is that a file written by another version of the app isn't handed back as if
 * this version had written it.
 */

import { PRACTICE_STORE_VERSION, PracticeStoreData } from '../../common/bots/practice'
import { readJsonFile, writeJsonFileAtomic } from './json-file'

function isPracticeStoreData(value: unknown): value is PracticeStoreData {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const data = value as Partial<PracticeStoreData>
  return (
    data.version === PRACTICE_STORE_VERSION &&
    typeof data.matchmaking === 'object' &&
    data.matchmaking !== null &&
    typeof data.customGame === 'object' &&
    data.customGame !== null &&
    Array.isArray(data.opponentPresets) &&
    Array.isArray(data.mapPoolPresets) &&
    Array.isArray(data.recentMapIds) &&
    Array.isArray(data.history) &&
    typeof data.knownMaps === 'object' &&
    data.knownMaps !== null
  )
}

/**
 * Reads the stored practice setup. Returns undefined when there is nothing usable to read, which
 * the renderer treats as a fresh setup; the file is left alone either way, so a version this build
 * doesn't understand survives a downgrade.
 */
export async function loadPracticeStore(filePath: string): Promise<PracticeStoreData | undefined> {
  const value = await readJsonFile(filePath)
  if (value === undefined) {
    return undefined
  }
  if (!isPracticeStoreData(value)) {
    throw new Error('The saved practice setup is from a different version of ShieldBattery')
  }
  return value
}

export async function savePracticeStore(filePath: string, data: PracticeStoreData): Promise<void> {
  if (!isPracticeStoreData(data)) {
    throw new Error('Invalid practice setup')
  }
  await writeJsonFileAtomic(filePath, data)
}
