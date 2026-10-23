import prettyBytes from 'pretty-bytes'
import { getErrorStack } from '../../common/errors'
import { FilesErrorCode } from '../../common/files'
import { GetGamesQueryParams, GetGamesResponse } from '../../common/games/games'
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
import { DialogType } from '../dialogs/dialog-type'
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

export function addToFavorites(mapId: SbMapId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson<void>(apiUrl`maps/${mapId}/favorite`, {
      method: 'POST',
      signal: spec.signal,
    })

    dispatch({
      type: '@maps/addToFavorites',
      payload: mapId,
    })
  })
}

export function removeFromFavorites(mapId: SbMapId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson<void>(apiUrl`maps/${mapId}/favorite`, {
      method: 'DELETE',
      signal: spec.signal,
    })

    dispatch({
      type: '@maps/removeFromFavorites',
      payload: mapId,
    })
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

/** Takes a listed map out of the map listings. It stays reachable by its ID. */
export function delistMap(mapId: SbMapId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson<void>(apiUrl`maps/${mapId}/delist`, {
      method: 'POST',
      signal: spec.signal,
    })

    dispatch({
      type: '@maps/delistMap',
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

/** Gets a page of the games played on a map, newest first unless `params` sorts them otherwise. */
export function getMapGames(
  mapId: SbMapId,
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
