import {
  GetMapDetailsPayload,
  GetMapsPayload,
  MapInfoJson,
  MapPreferences,
  MapSortType,
  MapVisibility,
  Tileset,
  UpdateMapPayload,
  UpdateMapServerBody,
} from '../../common/maps'
import { ThunkAction } from '../dispatch-registry'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
import { openSnackbar } from '../snackbars/action-creators'
import { ClearMaps } from './actions'

const upload = IS_ELECTRON ? require('./upload').default : null

export function uploadLocalMap(path: string, onMapSelect: (map: MapInfoJson) => void): ThunkAction {
  return async dispatch => {
    if (!upload) {
      return
    }

    dispatch({
      type: '@maps/uploadLocalMapBegin',
      payload: { path },
    })

    dispatch({
      type: '@maps/uploadLocalMap',
      payload: upload(path, apiUrl`maps`).then(({ map }: { map: MapInfoJson }) => {
        if (onMapSelect) {
          onMapSelect(map)
        }

        return map
      }),
      meta: { path },
    })
  }
}

export function getMapsList(
  visibility: MapVisibility,
  limit: number,
  page: number,
  sort: MapSortType,
  numPlayers: number,
  tileset: Tileset,
  searchQuery: string,
): ThunkAction {
  return dispatch => {
    const params = { visibility, limit, page, sort, numPlayers, tileset, searchQuery }

    dispatch({
      type: '@maps/getMapsBegin',
      payload: params,
    })

    const reqUrl = apiUrl`maps?visibility=${visibility}&sort=${sort}&numPlayers=${JSON.stringify(
      numPlayers,
    )}&tileset=${JSON.stringify(tileset)}&q=${searchQuery}&limit=${limit}&page=${page}`

    dispatch({
      type: '@maps/getMaps',
      payload: fetch<GetMapsPayload>(reqUrl),
      meta: params,
    })
  }
}

export function toggleFavoriteMap(
  map: MapInfoJson,
  context: Record<string, unknown> = {},
): ThunkAction {
  return dispatch => {
    const params = { map, context }

    dispatch({
      type: '@maps/toggleFavoriteMapBegin',
      payload: params,
    })

    const reqUrl = apiUrl`maps/favorites/${map.id}`
    dispatch({
      type: '@maps/toggleFavoriteMap',
      payload: fetch<void>(reqUrl, { method: map.isFavorited ? 'DELETE' : 'POST' }).then<void>(
        () => {
          dispatch(
            openSnackbar({
              message: map.isFavorited ? 'Removed from favorites' : 'Saved to favorites',
            }),
          )
        },
      ),
      meta: params,
    })
  }
}

export function removeMap(map: MapInfoJson): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@maps/removeMapBegin',
      payload: { map },
    })

    dispatch({
      type: '@maps/removeMap',
      payload: fetch<void>(apiUrl`maps/${map.id}`, { method: 'DELETE' }),
      meta: { map },
    })
  }
}

export function regenMapImage(map: MapInfoJson): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@maps/regenMapImageBegin',
      payload: { map },
    })

    const reqPromise = fetch<void>(apiUrl`maps/${map.id}/regenerate`, { method: 'POST' })

    reqPromise.then(
      () => {
        dispatch(
          openSnackbar({
            message: 'Images regenerated',
          }),
        )
      },
      () => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while regenerating images',
          }),
        )
      },
    )

    dispatch({
      type: '@maps/regenMapImage',
      payload: reqPromise,
      meta: { map },
    })
  }
}

export function clearMapsList(): ClearMaps {
  return {
    type: '@maps/clearMaps',
  }
}

export function getMapDetails(mapId: string): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@maps/getMapDetailsBegin',
      payload: { mapId },
    })
    dispatch({
      type: '@maps/getMapDetails',
      payload: fetch<GetMapDetailsPayload>(apiUrl`maps/${mapId}`),
      meta: { mapId },
    })
  }
}

export function updateMap(mapId: string, name: string, description: string): ThunkAction {
  return dispatch => {
    const params: UpdateMapServerBody = { mapId, name, description }

    dispatch({
      type: '@maps/updateMapBegin',
      payload: params,
    })

    dispatch({
      type: '@maps/updateMap',
      payload: fetch<UpdateMapPayload>(apiUrl`maps/${mapId}`, {
        method: 'PATCH',
        body: JSON.stringify(params),
      }),
      meta: params,
    })
  }
}

export function getMapPreferences(): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@maps/getMapPreferencesBegin',
    })

    dispatch({
      type: '@maps/getMapPreferences',
      payload: fetch<MapPreferences>(apiUrl`mapPreferences`),
    })
  }
}

export function updateMapPreferences(preferences: MapPreferences): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@maps/updateMapPreferencesBegin',
      payload: preferences,
    })

    dispatch({
      type: '@maps/updateMapPreferences',
      payload: fetch<MapPreferences>(apiUrl`mapPreferences`, {
        method: 'post',
        body: JSON.stringify(preferences),
      }),
      meta: preferences,
    })
  }
}
