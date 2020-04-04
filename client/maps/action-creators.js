import fetch from '../network/fetch'
import {
  LOCAL_MAPS_SELECT_BEGIN,
  LOCAL_MAPS_SELECT,
  MAPS_DETAILS_GET_BEGIN,
  MAPS_DETAILS_GET,
  MAPS_LIST_CLEAR,
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
  MAPS_REMOVE_BEGIN,
  MAPS_REMOVE,
  MAPS_TOGGLE_FAVORITE_BEGIN,
  MAPS_TOGGLE_FAVORITE,
  MAPS_UPDATE_BEGIN,
  MAPS_UPDATE,
  MAPS_PREFERENCES_GET_BEGIN,
  MAPS_PREFERENCES_GET,
  MAPS_PREFERENCES_UPDATE_BEGIN,
  MAPS_PREFERENCES_UPDATE,
} from '../actions'

const upload = IS_ELECTRON ? require('./upload').default : null

export function selectLocalMap(path, onMapSelect) {
  return async dispatch => {
    dispatch({ type: LOCAL_MAPS_SELECT_BEGIN })

    dispatch({
      type: LOCAL_MAPS_SELECT,
      payload: upload(path, '/api/1/maps').then(({ map }) => {
        if (onMapSelect) {
          onMapSelect(map)
        }
      }),
    })
  }
}

export function getMapsList(visibility, limit, page, sort, numPlayers, tileset, searchQuery) {
  return dispatch => {
    dispatch({ type: MAPS_LIST_GET_BEGIN })

    const reqUrl =
      `/api/1/maps?visibility=${visibility}&sort=${sort}` +
      `&numPlayers=${JSON.stringify(numPlayers)}&tileset=${JSON.stringify(tileset)}` +
      `&q=${searchQuery}&limit=${limit}&page=${page}`
    dispatch({ type: MAPS_LIST_GET, payload: fetch(reqUrl) })
  }
}

export function toggleFavoriteMap(map) {
  return dispatch => {
    dispatch({ type: MAPS_TOGGLE_FAVORITE_BEGIN, meta: { map } })

    const reqUrl = `/api/1/maps/favorites/${map.id}`
    dispatch({
      type: MAPS_TOGGLE_FAVORITE,
      payload: fetch(reqUrl, { method: map.isFavorited ? 'DELETE' : 'POST' }),
      meta: { map },
    })
  }
}

export function removeMap(map) {
  return dispatch => {
    dispatch({ type: MAPS_REMOVE_BEGIN, meta: { map } })

    dispatch({
      type: MAPS_REMOVE,
      payload: fetch(`/api/1/maps/${map.id}`, { method: 'DELETE' }),
      meta: { map },
    })
  }
}

export function clearMapsList() {
  return {
    type: MAPS_LIST_CLEAR,
  }
}

export function getMapDetails(mapId) {
  return dispatch => {
    dispatch({ type: MAPS_DETAILS_GET_BEGIN })
    dispatch({ type: MAPS_DETAILS_GET, payload: fetch(`/api/1/maps/${mapId}`) })
  }
}

export function updateMap(mapId, name, description) {
  return dispatch => {
    dispatch({ type: MAPS_UPDATE_BEGIN })

    dispatch({
      type: MAPS_UPDATE,
      payload: fetch(`/api/1/maps/${mapId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description }),
      }),
    })
  }
}

export function getMapPreferences() {
  return dispatch => {
    dispatch({ type: MAPS_PREFERENCES_GET_BEGIN })
    dispatch({
      type: MAPS_PREFERENCES_GET,
      payload: fetch('/api/1/mapPreferences'),
    })
  }
}

export function updateMapPreferences(preferences) {
  return dispatch => {
    dispatch({ type: MAPS_PREFERENCES_UPDATE_BEGIN })
    dispatch({
      type: MAPS_PREFERENCES_UPDATE,
      payload: fetch('/api/1/mapPreferences', {
        method: 'post',
        body: JSON.stringify(preferences),
      }),
    })
  }
}
