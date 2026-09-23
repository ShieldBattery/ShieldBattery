import { Draft } from 'immer'
import { debounce } from 'lodash-es'
import {
  MAX_PRACTICE_HISTORY,
  PracticeGameRecord,
  PracticeStoreData,
  createDefaultPracticeStore,
} from '../../common/bots/practice'
import { TypedIpcRenderer } from '../../common/ipc'
import { MapInfoJson, SbMapId } from '../../common/maps'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { practiceStoreAtom, practiceStoreLoadedAtom } from './practice-atoms'

const ipcRenderer = new TypedIpcRenderer()

const saveToDisk = debounce(() => {
  if (!jotaiStore.get(practiceStoreLoadedAtom)) {
    return
  }
  ipcRenderer.invoke('practiceStoreSave', jotaiStore.get(practiceStoreAtom))?.catch(err => {
    logger.error(`Failed to save practice setup: ${err?.stack ?? err}`)
  })
}, 300)

/** Loads the persisted practice data once; safe to call again (later calls are no-ops). */
export async function loadPracticeStore(): Promise<void> {
  if (jotaiStore.get(practiceStoreLoadedAtom)) {
    return
  }
  try {
    const data = await ipcRenderer.invoke('practiceStoreLoad')
    if (!jotaiStore.get(practiceStoreLoadedAtom)) {
      jotaiStore.set(practiceStoreAtom, () => ({
        ...createDefaultPracticeStore(),
        ...(data ?? {}),
      }))
    }
  } catch (err: any) {
    logger.error(`Failed to load practice setup: ${err?.stack ?? err}`)
  } finally {
    jotaiStore.set(practiceStoreLoadedAtom, true)
  }
}

/** Applies an edit to the practice store and schedules it to be written to disk. */
export function updatePracticeStore(recipe: (draft: Draft<PracticeStoreData>) => void): void {
  jotaiStore.set(practiceStoreAtom, recipe)
  saveToDisk()
}

/** Keeps a map's metadata so setups referencing it keep working offline. */
export function rememberMaps(maps: ReadonlyArray<MapInfoJson>): void {
  if (maps.length === 0) {
    return
  }
  updatePracticeStore(draft => {
    for (const map of maps) {
      draft.knownMaps[map.id] = map as MapInfoJson
    }
  })
}

export function findRecordBySession(
  store: PracticeStoreData,
  sessionId: string,
): PracticeGameRecord | undefined {
  return store.history.find(r => r.sessionId === sessionId)
}

/** Adds or replaces a history record, keeping the newest games first and the list bounded. */
export function recordPracticeGame(record: PracticeGameRecord): void {
  updatePracticeStore(draft => {
    const index = draft.history.findIndex(r => r.sessionId === record.sessionId)
    if (index >= 0) {
      draft.history[index] = record
    } else {
      draft.history.unshift(record)
      if (draft.history.length > MAX_PRACTICE_HISTORY) {
        draft.history.length = MAX_PRACTICE_HISTORY
      }
    }
  })
}

export function updatePracticeRecord(
  sessionId: string,
  recipe: (draft: Draft<PracticeGameRecord>) => void,
): void {
  updatePracticeStore(draft => {
    const record = draft.history.find(r => r.sessionId === sessionId)
    if (record) {
      recipe(record)
    }
  })
}

export function knownMapIdsToMaps(
  store: PracticeStoreData,
  mapIds: ReadonlyArray<SbMapId>,
): MapInfoJson[] {
  return mapIds.map(id => store.knownMaps[id]).filter((m): m is MapInfoJson => !!m)
}
