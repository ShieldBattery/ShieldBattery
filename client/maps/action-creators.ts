import prettyBytes from 'pretty-bytes'
import { getErrorStack } from '../../common/errors'
import { FilesErrorCode } from '../../common/files'
import {
  GetBatchMapInfoResponse,
  GetMapsResponse,
  MAX_MAP_FILE_SIZE_BYTES,
  SbMapId,
  UpdateMapResponse,
  UpdateMapServerRequest,
  UploadMapResponse,
} from '../../common/maps'
import { apiUrl, urlPath } from '../../common/urls'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { MicrotaskBatchRequester } from '../network/batch-requests'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { GetMapsListParams } from './actions'
import { ClientSideUploadError, upload } from './upload'

async function uploadMap(filePath: string) {
  if (IS_ELECTRON) {
    return upload<UploadMapResponse>(filePath, apiUrl`maps`, MAX_MAP_FILE_SIZE_BYTES)
  } else {
    throw new Error('cannot upload maps on non-electron clients')
  }
}

export function uploadLocalMap(
  path: string,
  spec: RequestHandlingSpec<UploadMapResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    try {
      const result = await uploadMap(path)

      dispatch({
        type: '@maps/uploadLocalMap',
        payload: result,
        meta: { path },
      })

      return result
    } catch (err) {
      let message = i18n.t(
        'maps.local.uploadMapError',
        'An unknown error occurred while uploading the map. Please try again later.',
      )

      if (err instanceof ClientSideUploadError || (isFetchError(err) && err.code)) {
        if (err.code === FilesErrorCode.MaxFileSizeExceeded) {
          message = i18n.t('maps.local.mapFileSizeErrorMessage', {
            defaultValue: "The map's file size exceeds the maximum allowed size of {{fileSize}}.",
            fileSize: prettyBytes(MAX_MAP_FILE_SIZE_BYTES),
          })
        }
      }

      dispatch(
        openSimpleDialog(
          i18n.t('maps.local.uploadMapErrorTitle', 'Error uploading the map'),
          message,
          true,
        ),
      )

      throw err
    }
  })
}

export function getMaps(
  params: GetMapsListParams,
  spec: RequestHandlingSpec<GetMapsResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const { visibility, sort, numPlayers, tileset, searchQuery, offset } = params

    const queryParams = new URLSearchParams()
    queryParams.set('visibility', visibility)
    queryParams.set('sort', sort.toString())
    for (const playerCount of numPlayers) {
      queryParams.append('numPlayers', playerCount.toString())
    }
    for (const tileSet of tileset) {
      queryParams.append('tileset', tileSet.toString())
    }
    queryParams.set('q', searchQuery)
    queryParams.set('offset', offset.toString())

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

export function removeMap(mapId: SbMapId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    return fetchJson<void>(apiUrl`maps/${mapId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

export function regenMapImage(mapId: SbMapId, spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    return fetchJson<void>(apiUrl`maps/${mapId}/regenerate`, {
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

const mapsBatchRequester = new MicrotaskBatchRequester<string>(
  MAX_BATCH_MAP_REQUESTS,
  (dispatch, items) => {
    const params = items.map(m => urlPath`m=${m}`).join('&')
    const promise = fetchJson<GetBatchMapInfoResponse>(apiUrl`maps/batch-info` + '?' + params)
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

export function openMapPreviewDialog(mapId: SbMapId) {
  return openDialog({ type: DialogType.MapPreview, initData: { mapId } })
}
