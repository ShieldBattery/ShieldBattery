import { Immutable } from 'immer'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  GetMatchmakingMapPoolBody,
  GetPreferencesPayload,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../common/matchmaking'
import { ThunkAction } from '../dispatch-registry'
import { clientId } from '../network/client-id'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
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
      payload: fetch<void>(apiUrl`matchmaking/find`, {
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
      payload: fetch<void>(apiUrl`matchmaking/find`, { method: 'DELETE' }),
    })
  }
}

export function acceptMatch(): ThunkAction {
  return dispatch => {
    dispatch({ type: '@matchmaking/acceptMatchBegin' })

    dispatch({
      type: '@matchmaking/acceptMatch',
      payload: fetch<void>(apiUrl`matchmaking/accept`, { method: 'POST' }),
    })
  }
}

export function getCurrentMapPool(type: MatchmakingType): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@matchmaking/getCurrentMapPoolBegin',
      payload: { type },
    })

    const promise = fetch<GetMatchmakingMapPoolBody>(apiUrl`matchmaking-map-pools/${type}/current`)

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

    const promise = fetch<GetPreferencesPayload>(
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

    promise.then(payload => {
      const {
        matchmaking: { mapPoolTypes },
      } = getState()

      if (
        !mapPoolTypes.has(matchmakingType) ||
        mapPoolTypes.get(matchmakingType)!.id !== payload.currentMapPoolId
      ) {
        dispatch(getCurrentMapPool(matchmakingType))
      }
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
