import { Immutable } from 'immer'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  GetMatchmakingMapPoolBody,
  GetPreferencesResponse,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../common/matchmaking'
import { apiUrl } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { clientId } from '../network/client-id'
import { fetchJson } from '../network/fetch'
import { UpdateLastQueuedMatchmakingType } from './actions'

const ipcRenderer = new TypedIpcRenderer()

export function findMatch<M extends MatchmakingType>(
  matchmakingType: M,
  preferences: Immutable<MatchmakingPreferences & { matchmakingType: M }>,
): ThunkAction {
  return dispatch => {
    ipcRenderer.send('rallyPointRefreshPings')

    const params = { clientId, preferences }
    dispatch({
      type: '@matchmaking/findMatchBegin',
      payload: params,
    })

    dispatch({
      type: '@matchmaking/findMatch',
      payload: fetchJson<void>(apiUrl`matchmaking/find`, {
        method: 'POST',
        body: JSON.stringify(params),
      }).then<{ startTime: number }>(() => {
        dispatch(updateLastQueuedMatchmakingType(matchmakingType))
        // Load the current map pool in the store so we can download all of the maps in it as soon
        // as the player queues.
        dispatch(getCurrentMapPool(matchmakingType))

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
      payload: fetchJson<void>(apiUrl`matchmaking/find`, { method: 'DELETE' }),
    })
  }
}

export function acceptMatch(): ThunkAction {
  return (dispatch, getState) => {
    const {
      matchmaking: { isAccepting },
    } = getState()

    if (isAccepting) {
      return
    }

    dispatch({ type: '@matchmaking/acceptMatchBegin' })

    dispatch({
      type: '@matchmaking/acceptMatch',
      payload: fetchJson<void>(apiUrl`matchmaking/accept`, { method: 'POST' }),
    })
  }
}

export function getCurrentMapPool(type: MatchmakingType): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@matchmaking/getCurrentMapPoolBegin',
      payload: { type },
    })

    const promise = fetchJson<GetMatchmakingMapPoolBody>(
      apiUrl`matchmaking-map-pools/${type}/current`,
    )

    promise.then(body => {
      // As a slight optimization, we download the whole map pool as soon as we get it. This
      // shouldn't be a prohibitively expensive operation, since our map store checks if a map
      // already exists before attempting to download it.
      for (const map of body.mapInfos) {
        ipcRenderer
          .invoke('mapStoreDownloadMap', map.hash, map.mapData.format, map.mapUrl!)
          ?.catch(err => {
            // This is already logged to our file by the map store, so we just log it to the
            // console for easy visibility during development
            console.error('Error downloading map: ' + err + '\n' + err.stack)
          })
      }
    })

    dispatch({
      type: '@matchmaking/getCurrentMapPool',
      payload: promise,
      meta: { type },
    })
  }
}

export function updateMatchmakingPreferences<M extends MatchmakingType>(
  matchmakingType: M,
  prefs: Immutable<MatchmakingPreferences & { matchmakingType: M }>,
): ThunkAction {
  return (dispatch, getState) => {
    dispatch({
      type: '@matchmaking/updatePreferencesBegin',
      payload: matchmakingType,
    })

    const promise = fetchJson<GetPreferencesResponse>(
      apiUrl`matchmakingPreferences/${matchmakingType}`,
      {
        method: 'POST',
        body: JSON.stringify(prefs),
      },
    )

    dispatch({
      type: '@matchmaking/updatePreferences',
      payload: promise,
      meta: { type: matchmakingType },
    })

    promise
      .then(payload => {
        const {
          mapPools: { byType },
        } = getState()

        if (
          !byType.has(matchmakingType) ||
          byType.get(matchmakingType)!.id !== payload.currentMapPoolId
        ) {
          dispatch(getCurrentMapPool(matchmakingType))
        }
      })
      .catch(() => {
        // Errors will be handled by the redux dispatch, but if we don't have an error handler here
        // it will count as unhandled.
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
