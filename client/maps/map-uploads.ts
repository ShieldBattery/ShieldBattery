import { TFunction } from 'i18next'
import { atom, useSetAtom } from 'jotai'
import { nanoid } from 'nanoid'
import { useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import { Client, useClient } from 'urql'
import { MapCatalogTab, urlForMap, urlForMapCatalog } from '../../common/map-url'
import { filterColorCodes, MapInfoJson, SbMapId } from '../../common/maps'
import { graphql } from '../gql'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { loadMapAddedToLibrary, mapUploadErrorMessage, uploadMapFile } from './action-creators'
import { UploadedMap } from './actions'
import { CatalogSort } from './map-catalog-params'
import { hashMapFile } from './map-file-hash'

/** A map file being uploaded from the catalog or the map picker, or one that failed to upload. */
export interface PendingMapUpload {
  key: string
  fileName: string
  /** The fraction of the file sent so far, once sending it has started. */
  progress?: number
  /** Why the upload failed. Unset while it's still uploading. */
  error?: string
}

/** Uploads that haven't succeeded yet, oldest first. */
export const pendingMapUploadsAtom = atom<ReadonlyArray<PendingMapUpload>>([])

/**
 * Changes whenever an upload adds maps to the viewer's library, so lists of it know to reload.
 */
export const mapLibraryVersionAtom = atom(0)

/** The extensions of map files that can be uploaded. */
export const MAP_FILE_EXTENSIONS: ReadonlyArray<string> = ['scm', 'scx']

export function isMapFile(file: File) {
  const dot = file.name.lastIndexOf('.')
  return dot !== -1 && MAP_FILE_EXTENSIONS.includes(file.name.slice(dot + 1).toLowerCase())
}

const MapUploadKnownMapQuery = graphql(/* GraphQL */ `
  query MapUploadKnownMap($hashes: [String!]!) {
    mapsByHash(hashes: $hashes) {
      id
    }
  }
`)

const MapUploadAddToLibraryMutation = graphql(/* GraphQL */ `
  mutation MapUploadAddToLibrary($id: SbMapId!) {
    mapAddToLibrary(id: $id) {
      id
      inLibrary
    }
  }
`)

/**
 * Adds the map in `file` to the viewer's library without uploading the file, if the server already
 * has it. Returns the map's id, or `undefined` if the file has to be uploaded.
 */
async function addKnownMapToLibrary(client: Client, file: File): Promise<SbMapId | undefined> {
  const hash = await hashMapFile(file)
  const known = await client
    .query(MapUploadKnownMapQuery, { hashes: [hash] }, { requestPolicy: 'network-only' })
    .toPromise()
  const mapId = known.data?.mapsByHash[0]?.id as SbMapId | undefined
  if (known.error || !mapId) {
    return undefined
  }

  const added = await client.mutation(MapUploadAddToLibraryMutation, { id: mapId }).toPromise()
  return added.error ? undefined : mapId
}

/**
 * Returns a function that adds the map in `file` to the viewer's own maps, resolving to the map once
 * it's in. A file the server already has is added without uploading it; otherwise the file is
 * uploaded, with the fraction of it sent so far reported to `onProgress`. Rejects with what went
 * wrong, for {@link mapUploadErrorMessage}.
 */
export function useAddMapFileToLibrary(): (
  file: File,
  onProgress?: (fraction: number) => void,
) => Promise<UploadedMap> {
  const dispatch = useAppDispatch()
  const client = useClient()
  const setLibraryVersion = useSetAtom(mapLibraryVersionAtom)

  return async (file, onProgress) => {
    // Failing to check is no reason not to upload, so any error here just means uploading
    const knownMapId = await addKnownMapToLibrary(client, file).catch(() => undefined)
    const uploaded = await new Promise<UploadedMap>((resolve, reject) => {
      const spec = { onSuccess: resolve, onError: reject }
      dispatch(
        knownMapId
          ? loadMapAddedToLibrary(knownMapId, spec)
          : uploadMapFile(file, spec, onProgress),
      )
    })
    setLibraryVersion(v => v + 1)
    return uploaded
  }
}

/**
 * A map upload's status: how much of the file has been sent, then that the server is processing it
 * (parsing it and rendering its images), which it does before it answers.
 */
export function uploadStatusText(progress: number | undefined, t: TFunction): string {
  if (progress === undefined) {
    return t('maps.catalog.uploading', 'Uploading…')
  } else if (progress >= 1) {
    return t('maps.catalog.processing', 'Processing…')
  }
  return t('maps.catalog.uploadingPercent', {
    defaultValue: 'Uploading… {{percent}}%',
    percent: Math.floor(progress * 100),
  })
}

export interface UploadMapFilesOptions {
  /**
   * Called when map files start uploading. By default they're shown on the catalog's Your maps
   * tab.
   */
  onStart?: (files: ReadonlyArray<File>) => void
  /**
   * Called with each map once it's in the viewer's maps. By default a snackbar links to it.
   */
  onUploaded?: (map: ReadonlyDeep<MapInfoJson>, files: ReadonlyArray<File>) => void
}

/**
 * Returns a function that adds map files the user picked or dropped to their own maps, one at a
 * time, tracking them in {@link pendingMapUploadsAtom} until they're in. A file the server already
 * has is added without uploading it. Files that aren't maps are ignored.
 */
export function useUploadMapFiles(
  options: UploadMapFilesOptions = {},
): (files: Iterable<File>) => void {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const setPending = useSetAtom(pendingMapUploadsAtom)
  const addToLibrary = useAddMapFileToLibrary()

  const showUploaded = (map: ReadonlyDeep<MapInfoJson>) => {
    snackbarController.showSnackbar(
      t('maps.catalog.uploaded', {
        defaultValue: 'Uploaded {{name}}',
        name: filterColorCodes(map.name),
      }),
      undefined,
      {
        action: {
          label: t('maps.catalog.viewMap', 'View map'),
          onClick: () => push(urlForMap(map.id, map.name)),
        },
      },
    )
  }

  const uploadOne = async (file: File, files: ReadonlyArray<File>) => {
    const key = nanoid()
    const update = (changes: Partial<PendingMapUpload>) =>
      setPending(pending => pending.map(p => (p.key === key ? { ...p, ...changes } : p)))
    setPending(pending => [...pending, { key, fileName: file.name }])

    try {
      const { map } = await addToLibrary(file, progress => update({ progress }))
      setPending(pending => pending.filter(p => p.key !== key))
      if (options.onUploaded) {
        options.onUploaded(map, files)
      } else {
        showUploaded(map)
      }
    } catch (err) {
      update({ error: mapUploadErrorMessage(err) })
    }
  }

  return files => {
    const mapFiles = Array.from(files).filter(isMapFile)
    if (!mapFiles.length) {
      return
    }

    if (options.onStart) {
      options.onStart(mapFiles)
    } else {
      // Newest first, so the uploads land at the top of the list, with no filters that might hide
      // them
      push(urlForMapCatalog(MapCatalogTab.Yours, `sort=${CatalogSort.Newest}`))
    }
    // The server limits how quickly maps can be uploaded, so they go one at a time
    mapFiles
      .reduce((prev, file) => prev.then(() => uploadOne(file, mapFiles)), Promise.resolve())
      .catch(() => {})
  }
}
