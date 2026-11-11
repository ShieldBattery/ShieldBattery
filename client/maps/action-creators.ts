import prettyBytes from 'pretty-bytes'
import { getErrorStack } from '../../common/errors'
import { FilesErrorCode } from '../../common/files'
import { GetGamesQueryParams, GetGamesResponse } from '../../common/games/games'
import { MapPageId } from '../../common/map-url'
import {
  GetBatchMapInfoResponse,
  GetMapsQueryParams,
  GetMapsResponse,
  MapServiceErrorCode,
  MAX_MAP_FILE_SIZE_BYTES,
  SbMapId,
  UpdateMapResponse,
  UpdateMapServerRequest,
} from '../../common/maps'
import { UploadMapResponse } from '../../common/typeshare'
import { apiUrl, urlPath } from '../../common/urls'
import { openDialog } from '../dialogs/action-creators'
import { DialogType, MapFamilyActionKind } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import { buildGameListSearchParams } from '../games/game-filter-url'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { MicrotaskBatchRequester } from '../network/batch-requests'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { makeServerRsUrl } from '../network/server-url'
import { UploadedMap } from './actions'
import { ClientSideUploadError, uploadFile } from './upload'

function fetchBatchMapInfo(mapIds: ReadonlyArray<SbMapId>, signal?: AbortSignal) {
  const params = mapIds.map(m => urlPath`m=${m}`).join('&')
  return fetchJson<GetBatchMapInfoResponse>(apiUrl`maps/batch-info` + '?' + params, { signal })
}

/**
 * Uploads a map file to the current user's own maps, returning the uploaded map along with the
 * info needed to display it. Upload progress is reported to `onProgress`.
 */
async function uploadMap(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<UploadedMap> {
  const url = makeServerRsUrl(urlPath`/maps`)
  const { mapId } = await uploadFile<UploadMapResponse>(
    file,
    url,
    MAX_MAP_FILE_SIZE_BYTES,
    onProgress,
  )
  return loadUploadedMap(mapId)
}

async function loadUploadedMap(mapId: SbMapId): Promise<UploadedMap> {
  const { maps, libraryMapIds, users } = await fetchBatchMapInfo([mapId])
  const map = maps.find(m => m.id === mapId)
  if (!map) {
    throw new Error(`uploaded map ${mapId} could not be found`)
  }

  return { map, libraryMapIds, users }
}

/** Returns a message explaining why uploading a map failed with `err`, for showing the user. */
export function mapUploadErrorMessage(err: unknown): string {
  if (err instanceof ClientSideUploadError || (isFetchError(err) && err.code)) {
    if (err.code === FilesErrorCode.MaxFileSizeExceeded) {
      return i18n.t('maps.local.mapFileSizeErrorMessage', {
        defaultValue: "The map's file size exceeds the maximum allowed size of {{fileSize}}.",
        fileSize: prettyBytes(MAX_MAP_FILE_SIZE_BYTES),
      })
    } else if (err.code === MapServiceErrorCode.NoPlayerSlots) {
      return i18n.t(
        'maps.local.uploadMapNoPlayerSlotsError',
        'This map has no start locations or usable player slots, so it can never be ' +
          'played. Add start locations to the map and try again.',
      )
    } else if (err.code === MapServiceErrorCode.InvalidMapFile) {
      return i18n.t(
        'maps.local.uploadMapInvalidFileError',
        "This file couldn't be read as a StarCraft map. It may be corrupted or protected in a " +
          'way we cannot read.',
      )
    }
  }

  return i18n.t(
    'maps.local.uploadMapError',
    'An unknown error occurred while uploading the map. Please try again later.',
  )
}

/**
 * Uploads a map file the user picked or dropped to their own maps, reporting the fraction of it
 * sent so far to `onProgress`. Callers show failures themselves, with
 * {@link mapUploadErrorMessage}.
 */
export function uploadMapFile(
  file: File,
  spec: RequestHandlingSpec<UploadedMap>,
  onProgress?: (fraction: number) => void,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await uploadMap(file, onProgress)
    dispatch({ type: '@maps/uploadMap', payload: result })
    return result
  })
}

/**
 * Stores a map that was just added to the current user's own maps without uploading its file (the
 * server already had it), the same way an upload of it would.
 */
export function loadMapAddedToLibrary(
  mapId: SbMapId,
  spec: RequestHandlingSpec<UploadedMap>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await loadUploadedMap(mapId)
    dispatch({ type: '@maps/uploadMap', payload: result })
    return result
  })
}

export function getMaps(
  params: GetMapsQueryParams,
  spec: RequestHandlingSpec<GetMapsResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const { visibility, sort, numPlayers, tilesets, q, offset } = params

    const queryParams = new URLSearchParams()
    if (visibility) {
      queryParams.set('visibility', visibility)
    }
    if (sort !== undefined) {
      queryParams.set('sort', sort.toString())
    }
    if (numPlayers) {
      for (const playerCount of numPlayers) {
        queryParams.append('numPlayers', playerCount.toString())
      }
    }
    if (tilesets) {
      for (const tileset of tilesets) {
        queryParams.append('tilesets', tileset.toString())
      }
    }
    if (q) {
      queryParams.set('q', q)
    }
    if (offset !== undefined) {
      queryParams.set('offset', offset.toString())
    }

    const result = await fetchJson<GetMapsResponse>(apiUrl`maps?${queryParams}`, {
      signal: spec.signal,
    })

    dispatch({
      type: '@maps/getMaps',
      payload: result,
      meta: params,
    })

    return result
  })
}

/** Removes a map from the current user's own maps. The map itself stays available to others. */
export function removeFromMyMaps(mapId: SbMapId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson<void>(apiUrl`maps/${mapId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })

    dispatch({
      type: '@maps/removeFromMyMaps',
      payload: mapId,
    })
  })
}

export function regenMapImage(mapId: SbMapId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    return fetchJson<void>(makeServerRsUrl(urlPath`/maps/${mapId}/regenerate`), {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function updateMap(
  mapId: SbMapId,
  params: UpdateMapServerRequest,
  spec: RequestHandlingSpec<UpdateMapResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<UpdateMapResponse>(apiUrl`maps/${mapId}`, {
      method: 'PATCH',
      signal: spec.signal,
      body: JSON.stringify(params),
    })

    dispatch({
      type: '@maps/updateMap',
      payload: result,
      meta: params,
    })

    return result
  })
}

const MAX_BATCH_MAP_REQUESTS = 50

const mapsBatchRequester = new MicrotaskBatchRequester<SbMapId>(
  MAX_BATCH_MAP_REQUESTS,
  (dispatch, items) => {
    const promise = fetchBatchMapInfo(items)
    dispatch({
      type: '@maps/getBatchMapInfo',
      payload: promise,
    })

    return promise
  },
  err => {
    logger.error('error while batch requesting maps: ' + getErrorStack(err))
  },
)

/**
 * Queues a request to the server for map information, if necessary. This will batch multiple
 * requests that happen close together into one request to the server.
 */
export function batchGetMapInfo(mapId: SbMapId, maxCacheAgeMillis = 60000): ThunkAction {
  return (dispatch, getState) => {
    const {
      maps: { byId, lastRetrieved },
    } = getState()

    if (
      !byId.has(mapId) ||
      !lastRetrieved.has(mapId) ||
      window.performance.now() - lastRetrieved.get(mapId)! > maxCacheAgeMillis
    ) {
      mapsBatchRequester.request(dispatch, mapId)
    }
  }
}

/**
 * Requests a single map's info from the server, succeeding once the response has been stored. A map
 * the server doesn't know succeeds without being stored.
 */
export function getMapInfo(mapId: SbMapId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    dispatch({
      type: '@maps/getBatchMapInfo',
      payload: await fetchBatchMapInfo([mapId], spec.signal),
    })
  })
}

export function openMapPreviewDialog(mapId: SbMapId) {
  return openDialog({ type: DialogType.MapPreview, initData: { mapId } })
}

/** Opens the dialog that confirms a staff change to a map's files, spelling out its effects. */
export function openMapFamilyActionDialog(initData: {
  action: MapFamilyActionKind
  familyId: string
  fileId?: SbMapId
  selectedId?: SbMapId
  reportId?: string
  targetFamilyId?: string
}) {
  return openDialog({ type: DialogType.MapFamilyAction, initData })
}

/** Opens the dialog for telling staff that a map's files are wrong. */
export function openMapFamilyReportDialog(initData: {
  familyId: string
  fileId: SbMapId
  fileCount: number
}) {
  return openDialog({ type: DialogType.MapFamilyReport, initData })
}

/**
 * Opens the dialog that publishes a file from the user's maps. `selectedId` is the file a map's
 * page shows, when it's opened from one.
 */
export function openMapPublishDialog(initData: { fileId: SbMapId; selectedId?: SbMapId }) {
  return openDialog({ type: DialogType.MapPublish, initData })
}

/** Opens the dialog that adds a file its publisher listed alone to one of the maps it resembles. */
export function openMapFileLinkDialog(initData: { fileId: SbMapId; selectedId?: SbMapId }) {
  return openDialog({ type: DialogType.MapFileLink, initData })
}

/** Opens the dialog that confirms taking a file its publisher listed out of its map. */
export function openMapFileUnlinkDialog(initData: {
  fileName: string
  mapName: string
  onConfirm: () => void
}) {
  return openDialog({ type: DialogType.MapFileUnlink, initData })
}

/**
 * Opens the dialog for staff to take a file out of the listings, or block it from them. A report
 * given as `reportId` is resolved once the file is delisted.
 */
export function openMapDelistDialog(initData: {
  fileId: SbMapId
  name: string
  listed: boolean
  reportId?: string
}) {
  return openDialog({ type: DialogType.MapDelist, initData })
}

/** Opens the dialog that sends staff a user's claim to be the maker of a map. */
export function openMapOwnerClaimDialog(initData: { familyId: string; ownerName?: string }) {
  return openDialog({ type: DialogType.MapOwnerClaim, initData })
}

/** Opens the dialog that confirms giving up a map that staff confirmed the user made. */
export function openMapOwnerRelinquishDialog(initData: { onConfirm: () => void }) {
  return openDialog({ type: DialogType.MapOwnerRelinquish, initData })
}

/** Opens the dialog for staff to change who made a map: its owner and its credit. */
export function openMapOwnerEditDialog(initData: { familyId: string }) {
  return openDialog({ type: DialogType.MapOwnerEdit, initData })
}

/** Opens the dialog that adds files a map's owner published to that map. */
export function openMapOwnerAddFileDialog(initData: { familyId: string; mapName: string }) {
  return openDialog({ type: DialogType.MapOwnerAddFile, initData })
}

export function openMapDownloadDialog(mapId: SbMapId) {
  return openDialog({ type: DialogType.MapDownload, initData: { mapId } })
}

export function getMapDownloadUrl(mapId: SbMapId, spec: RequestHandlingSpec<string>): ThunkAction {
  return abortableThunk(spec, async () => {
    const result = await fetchJson<{ url: string }>(apiUrl`maps/${mapId}/download-url`, {
      method: 'POST',
      signal: spec.signal,
    })

    return result.url
  })
}

/**
 * Gets a page of the games played on a map, newest first unless `params` sorts them otherwise. A
 * map family's ID gives the games played on any of its files; a file's ID, the games of that file.
 */
export function getMapGames(
  mapId: MapPageId,
  params: GetGamesQueryParams,
  spec: RequestHandlingSpec<GetGamesResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const queryParams = buildGameListSearchParams(params)

    const result = await fetchJson<GetGamesResponse>(apiUrl`maps/${mapId}/games?${queryParams}`, {
      signal: spec.signal,
    })

    dispatch({
      type: '@maps/getMapGames',
      payload: result,
    })

    return result
  })
}
