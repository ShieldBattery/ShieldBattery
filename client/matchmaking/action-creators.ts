import { TypedIpcRenderer } from '../../common/ipc'
import { MapInfoJson } from '../../common/maps'
import {
  GetPreferencesPayload,
  MatchmakingMapPool,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../common/matchmaking'
import { ThunkAction } from '../dispatch-registry'
import { clientId } from '../network/client-id'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
import { UpdateLastQueuedMatchmakingType } from './actions'

const ipcRenderer = new TypedIpcRenderer()

export function findMatch(preferences: MatchmakingPreferences): ThunkAction {
  ipcRenderer.send('rallyPointRefreshPings')

  const params = { clientId, preferences }
  return dispatch => {
    dispatch({
      type: '@matchmaking/findMatchBegin',
      payload: params,
    })

    dispatch({
      type: '@matchmaking/findMatch',
      payload: fetch<void>(apiUrl`matchmaking/find`, {
        method: 'POST',
        body: JSON.stringify(params),
      }).then<{ startTime: number }>(() => {
        const { matchmakingType: type } = preferences

        dispatch(updateLastQueuedMatchmakingType(type))
        // Load the current map pool in the store so we can download all of the maps in it as soon
        // as the player queues.
        dispatch(getCurrentMapPool(type))

        return {
          startTime: window.performance.now(),
        }
      }),
      meta: params,
    })
  }
}

export function cancelFindMatch(): ThunkAction {
  return dispatch => {
    dispatch({ type: '@matchmaking/cancelMatchBegin' })

    dispatch({
      type: '@matchmaking/cancelMatch',
      payload: fetch<void>(apiUrl`matchmaking`, { method: 'DELETE' }),
    })
  }
}

export function acceptMatch(): ThunkAction {
  return dispatch => {
    dispatch({ type: '@matchmaking/acceptMatchBegin' })

    dispatch({
      type: '@matchmaking/acceptMatch',
      payload: fetch<void>(apiUrl`matchmaking`, { method: 'POST' }),
    })
  }
}

// TODO(2Pac): This can be cached
export function getCurrentMapPool(type: MatchmakingType): ThunkAction {
  return (dispatch, getState) => {
    dispatch({
      type: '@matchmaking/getCurrentMapPoolBegin',
      payload: { type },
    })
    dispatch({
      type: '@matchmaking/getCurrentMapPool',
      payload: fetch<MatchmakingMapPool>(
        apiUrl`matchmakingMapPools/${type}/current`,
      ).then<MatchmakingMapPool>(mapPool => {
        // As a slight optimization, we download the whole map pool as soon as we get it. This
        // shouldn't be a prohibitively expensive operation, since our map store checks if a map
        // already exists before attempting to download it.
        mapPool.maps.forEach((map: MapInfoJson) =>
          ipcRenderer
            .invoke('mapStoreDownloadMap', map.hash, map.mapData.format, map.mapUrl!)
            ?.catch(err => {
              // This is already logged to our file by the map store, so we just log it to the
              // console for easy visibility during development
              console.error('Error downloading map: ' + err + '\n' + err.stack)
            }),
        )

        return mapPool
      }),
      meta: { type },
    })
  }
}

export function updateMatchmakingPreferences(preferences: MatchmakingPreferences): ThunkAction {
  return dispatch => {
    const { matchmakingType } = preferences
    dispatch({
      type: '@matchmaking/updatePreferencesBegin',
      payload: matchmakingType,
    })
    dispatch({
      type: '@matchmaking/updatePreferences',
      payload: fetch<GetPreferencesPayload>(apiUrl`matchmakingPreferences/${matchmakingType}`, {
        method: 'POST',
        body: JSON.stringify(preferences),
      }),
      meta: { type: preferences.matchmakingType },
    })
  }
}

export function updateLastQueuedMatchmakingType(
  type: MatchmakingType,
): UpdateLastQueuedMatchmakingType {
  return {
    type: '@matchmaking/updateLastQueuedMatchmakingType',
    payload: type,
  }
}
