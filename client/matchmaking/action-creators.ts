import { Immutable } from 'immer'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  defaultPreferences,
  GetMatchmakingMapPoolBody,
  GetPreferencesResponse,
  MatchmakingPreferences,
  MatchmakingServiceErrorCode,
  MatchmakingType,
} from '../../common/matchmaking'
import { apiUrl } from '../../common/urls'
import { openSimpleDialog } from '../dialogs/action-creators'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { clientId } from '../network/client-id'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { UpdateLastQueuedMatchmakingType } from './actions'

const ipcRenderer = new TypedIpcRenderer()

export function findMatch<M extends MatchmakingType>(
  matchmakingType: M,
  preferences:
    | Immutable<MatchmakingPreferences & { matchmakingType: M }>
    | Record<string, never>
    | undefined,
): ThunkAction {
  return (dispatch, getState) => {
    ipcRenderer.send('rallyPointRefreshPings')

    const {
      auth: { user },
      mapPools: { byType: mapPoolByType },
    } = getState()
    const selfId = user.id

    const prefs =
      !!preferences && 'race' in preferences
        ? (preferences as Immutable<MatchmakingPreferences>)
        : defaultPreferences(
            matchmakingType,
            selfId,
            preferences?.mapPoolId ?? mapPoolByType.get(matchmakingType)?.id ?? 1,
          )

    const findPromise = fetchJson<void>(apiUrl`matchmaking/find`, {
      method: 'POST',
      body: JSON.stringify({ clientId, preferences: prefs }),
    })

    findPromise.catch(err => {
      let message = 'Something went wrong :('

      if (isFetchError(err) && err.code) {
        switch (err.code) {
          case MatchmakingServiceErrorCode.MatchmakingDisabled:
            message = 'Matchmaking is currently disabled'
            break
          case MatchmakingServiceErrorCode.InParty:
            message = 'You are in a party, cannot queue as a solo player'
            break
          case MatchmakingServiceErrorCode.GameplayConflict:
            message = 'You are already in a game, searching for a match, or in a custom lobby'
            break
          default:
            logger.error(
              `Unhandled error code while queueing for matchmaking as a solo player: ${err.code}`,
            )
            break
        }
      } else {
        logger.error(`Error while queuing for matchmaking as a solo player: ${err?.stack ?? err}`)
      }
      dispatch(openSimpleDialog('Error searching for a match', message, true))
    })

    findPromise
      .then(() => {
        dispatch(updateLastQueuedMatchmakingType(matchmakingType))
        // Load the current map pool in the store so we can download all of the maps in it as soon
        // as the player queues.
        dispatch(getCurrentMapPool(matchmakingType))
      })
      .catch(swallowNonBuiltins)
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
