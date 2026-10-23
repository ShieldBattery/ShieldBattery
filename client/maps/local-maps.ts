import { atom, useAtomValue, useSetAtom } from 'jotai'
import { debounce } from 'lodash-es'
import { useEffect } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  LocalMapFile,
  LocalMapFolder,
  LocalMapIndexProgress,
  LocalMapLibraryStatus,
  LocalMapQuery,
  LocalMapQueryResult,
} from '../../common/map-library'
import { MapInfoJson } from '../../common/maps'
import { jotaiStore } from '../jotai-store'
import { useAppDispatch } from '../redux-hooks'
import { mapUploadErrorMessage, uploadMapFile } from './action-creators'
import { mapLibraryVersionAtom } from './map-uploads'

/**
 * Access to the app's index of the map files in the user's StarCraft map folders (the "On this PC"
 * maps). Only meaningful in the desktop app.
 */

const ipcRenderer = new TypedIpcRenderer()

/** Changes whenever the index does, so anything read from it knows to read again. */
const localMapsVersionAtom = atom(0)
/** How far the index is through scanning or indexing files, while it is. */
const localMapsProgressAtom = atom<LocalMapIndexProgress | undefined>(undefined)

/** Index changes come in bursts while files are indexed; reading once per burst is enough. */
const CHANGE_DEBOUNCE_MS = 300

let listening = false

/** Starts relaying the index's events into the atoms above, once for the whole renderer. */
function listenForIndexEvents() {
  if (listening || !IS_ELECTRON) {
    return
  }
  listening = true
  ipcRenderer.on(
    'localMapsChanged',
    debounce(() => jotaiStore.set(localMapsVersionAtom, v => v + 1), CHANGE_DEBOUNCE_MS),
  )
  ipcRenderer.on('localMapsIndexProgress', (_event, progress) => {
    jotaiStore.set(localMapsProgressAtom, progress)
  })
}

/** A number that changes whenever the local map index does. */
export function useLocalMapsVersion(): number {
  useEffect(() => {
    listenForIndexEvents()
  }, [])
  return useAtomValue(localMapsVersionAtom)
}

/** How far the local map index is through scanning or indexing, while it is. */
export function useLocalMapsProgress(): LocalMapIndexProgress | undefined {
  useEffect(() => {
    listenForIndexEvents()
  }, [])
  return useAtomValue(localMapsProgressAtom)
}

/** A read from the index, which never rejects, so it can be handed to `use()` directly. */
export type IndexRead<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** The most reads kept, so returning to a listing or scrolling back reads nothing again. */
const MAX_CACHED_READS = 200
const readCache = new Map<string, Promise<IndexRead<unknown>>>()

/**
 * Reads from the index once per `version` and arguments, sharing the promise between every caller
 * (as `use()` needs a stable promise across renders).
 */
function cachedRead<T>(key: string, read: () => Promise<T>): Promise<IndexRead<T>> {
  const cached = readCache.get(key)
  if (cached) {
    return cached as Promise<IndexRead<T>>
  }
  const promise = read().then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error }),
  )
  readCache.set(key, promise)
  while (readCache.size > MAX_CACHED_READS) {
    readCache.delete(readCache.keys().next().value!)
  }
  return promise
}

export function readLocalMaps(
  query: LocalMapQuery,
  version: number,
): Promise<IndexRead<LocalMapQueryResult>> {
  return cachedRead(JSON.stringify(['query', version, query]), async () => {
    const result = await ipcRenderer.invoke('localMapsQuery', query)
    return result ?? { files: [], total: 0 }
  })
}

export function readLocalMapFolders(
  parent: string | undefined,
  version: number,
): Promise<IndexRead<LocalMapFolder[]>> {
  return cachedRead(JSON.stringify(['folders', version, parent ?? null]), async () => {
    return (await ipcRenderer.invoke('localMapsFolders', parent)) ?? []
  })
}

export function readLocalMapsStatus(version: number): Promise<IndexRead<LocalMapLibraryStatus>> {
  return cachedRead(JSON.stringify(['status', version]), async () => {
    const status = await ipcRenderer.invoke('localMapsStatus')
    if (!status) {
      throw new Error('the local map index is not available')
    }
    return status
  })
}

/** The state of an upload of a file on this PC, by the file's path. */
export interface LocalMapUpload {
  /** The fraction of the file sent so far, once sending it has started. */
  progress?: number
  /** Why the upload failed. */
  error?: string
}

const localUploadsAtom = atom<ReadonlyMap<string, LocalMapUpload>>(new Map())

export function useLocalMapUploads(): ReadonlyMap<string, LocalMapUpload> {
  return useAtomValue(localUploadsAtom)
}

/**
 * Returns a function that uploads a map file on this PC to the viewer's maps, tracking its progress
 * in {@link useLocalMapUploads}, and calls `onUploaded` with the map once it's in.
 */
export function useUploadLocalMapFile(): (
  file: LocalMapFile,
  onUploaded: (map: ReadonlyDeep<MapInfoJson>) => void,
) => void {
  const dispatch = useAppDispatch()
  const setUploads = useSetAtom(localUploadsAtom)
  const setLibraryVersion = useSetAtom(mapLibraryVersionAtom)

  const update = (path: string, upload: LocalMapUpload | undefined) => {
    setUploads(uploads => {
      const next = new Map(uploads)
      if (upload) {
        next.set(path, upload)
      } else {
        next.delete(path)
      }
      return next
    })
  }

  return (file, onUploaded) => {
    update(file.path, {})
    Promise.resolve(ipcRenderer.invoke('fsReadFile', file.path))
      .then(bytes => {
        dispatch(
          uploadMapFile(
            new File([bytes!], file.fileName),
            {
              onSuccess: ({ map }) => {
                update(file.path, undefined)
                setLibraryVersion(v => v + 1)
                onUploaded(map)
              },
              onError: err => update(file.path, { error: mapUploadErrorMessage(err) }),
            },
            progress => update(file.path, { progress }),
          ),
        )
      })
      .catch(err => update(file.path, { error: mapUploadErrorMessage(err) }))
  }
}
