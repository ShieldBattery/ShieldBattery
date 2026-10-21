import { atom, useSetAtom } from 'jotai'
import { nanoid } from 'nanoid'
import { useTranslation } from 'react-i18next'
import { MapCatalogTab, urlForMap, urlForMapCatalog } from '../../common/map-url'
import { filterColorCodes } from '../../common/maps'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { mapUploadErrorMessage, uploadMapFile } from './action-creators'
import { UploadedMap } from './actions'
import { CatalogSort } from './map-catalog-params'

/** A map file being uploaded from the catalog, or one that failed to upload. */
export interface PendingMapUpload {
  key: string
  fileName: string
  /** Why the upload failed. Unset while it's still uploading. */
  error?: string
}

/** Uploads started from the catalog that haven't succeeded yet, oldest first. */
export const pendingMapUploadsAtom = atom<ReadonlyArray<PendingMapUpload>>([])

/**
 * Changes whenever the catalog adds maps to the viewer's library, so lists of it know to reload.
 */
export const mapLibraryVersionAtom = atom(0)

/** The extensions of map files the catalog accepts. */
export const MAP_FILE_EXTENSIONS: ReadonlyArray<string> = ['scm', 'scx']

function isMapFile(file: File) {
  const dot = file.name.lastIndexOf('.')
  return dot !== -1 && MAP_FILE_EXTENSIONS.includes(file.name.slice(dot + 1).toLowerCase())
}

/**
 * Returns a function that uploads map files the user picked or dropped to their own maps, one at a
 * time, and shows them on the Your maps tab while they upload. Files that aren't maps are ignored.
 */
export function useUploadMapFiles(): (files: Iterable<File>) => void {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const setPending = useSetAtom(pendingMapUploadsAtom)
  const setLibraryVersion = useSetAtom(mapLibraryVersionAtom)

  const uploadOne = (file: File) =>
    new Promise<void>(resolve => {
      const key = nanoid()
      setPending(pending => [...pending, { key, fileName: file.name }])
      dispatch(
        uploadMapFile(file, {
          onSuccess: ({ map }: UploadedMap) => {
            setPending(pending => pending.filter(p => p.key !== key))
            setLibraryVersion(v => v + 1)
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
            resolve()
          },
          onError: err => {
            setPending(pending =>
              pending.map(p => (p.key === key ? { ...p, error: mapUploadErrorMessage(err) } : p)),
            )
            resolve()
          },
        }),
      )
    })

  return files => {
    const mapFiles = Array.from(files).filter(isMapFile)
    if (!mapFiles.length) {
      return
    }

    // Newest first, so the uploads land at the top of the list, with no filters that might hide
    // them
    push(urlForMapCatalog(MapCatalogTab.Yours, `sort=${CatalogSort.Newest}`))
    // The server limits how quickly maps can be uploaded, so they go one at a time
    mapFiles
      .reduce((prev, file) => prev.then(() => uploadOne(file)), Promise.resolve())
      .catch(() => {})
  }
}
