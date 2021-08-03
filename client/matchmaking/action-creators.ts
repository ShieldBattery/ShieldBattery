import { TypedIpcRenderer } from '../../common/ipc'
import {
  GetPreferencesPayload,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../common/matchmaking'
import { AssignedRaceChar, RaceChar } from '../../common/races'
import {
  MATCHMAKING_ACCEPT,
  MATCHMAKING_ACCEPT_BEGIN,
  MATCHMAKING_CANCEL,
  MATCHMAKING_CANCEL_BEGIN,
  MATCHMAKING_FIND,
  MATCHMAKING_FIND_BEGIN,
  MATCHMAKING_GET_CURRENT_MAP_POOL,
  MATCHMAKING_GET_CURRENT_MAP_POOL_BEGIN,
} from '../actions'
import { ThunkAction } from '../dispatch-registry'
import { clientId } from '../network/client-id'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'

const ipcRenderer = new TypedIpcRenderer()

export function findMatch(
  type: MatchmakingType,
  race: RaceChar,
  useAlternateRace: boolean,
  alternateRace: AssignedRaceChar,
  preferredMaps: string[],
): ThunkAction {
  ipcRenderer.send('rallyPointRefreshPings')

  const params = {
    clientId,
    type,
    race,
    useAlternateRace,
    alternateRace,
    preferredMaps,
  }

  return dispatch => {
    dispatch({
      type: MATCHMAKING_FIND_BEGIN,
      payload: params,
    } as any)

    dispatch({
      type: MATCHMAKING_FIND,
      payload: fetch<void>(apiUrl`matchmaking/find`, {
        method: 'POST',
        body: JSON.stringify(params),
      }).then(() => ({ startTime: window.performance.now() })),
      meta: params,
    } as any)
  }
}

export function cancelFindMatch(): ThunkAction {
  return dispatch => {
    dispatch({ type: MATCHMAKING_CANCEL_BEGIN } as any)

    dispatch({
      type: MATCHMAKING_CANCEL,
      payload: fetch<void>(apiUrl`matchmaking`, { method: 'DELETE' }),
    } as any)
  }
}

export function acceptMatch(): ThunkAction {
  return dispatch => {
    dispatch({ type: MATCHMAKING_ACCEPT_BEGIN } as any)

    dispatch({
      type: MATCHMAKING_ACCEPT,
      payload: fetch<void>(apiUrl`matchmaking`, { method: 'POST' }),
    } as any)
  }
}

// TODO(2Pac): This can be cached
export function getCurrentMapPool(type: MatchmakingType): ThunkAction {
  return dispatch => {
    dispatch({
      type: MATCHMAKING_GET_CURRENT_MAP_POOL_BEGIN,
      meta: { type },
    } as any)
    dispatch({
      type: MATCHMAKING_GET_CURRENT_MAP_POOL,
      payload: fetch(apiUrl`matchmakingMapPools/${type}/current`),
      meta: { type },
    } as any)
  }
}

export function getMatchmakingPreferences(matchmakingType: MatchmakingType): ThunkAction {
  return dispatch => {
    dispatch({ type: '@matchmaking/getPreferencesBegin', payload: { type: matchmakingType } })
    dispatch({
      type: '@matchmaking/getPreferences',
      payload: fetch<GetPreferencesPayload>(apiUrl`matchmakingPreferences/${matchmakingType}`),
      meta: { type: matchmakingType },
    })
  }
}

export function updateMatchmakingPreferences(preferences: MatchmakingPreferences): ThunkAction {
  return dispatch => {
    const { matchmakingType } = preferences
    dispatch({
      type: '@matchmaking/updatePreferencesBegin',
      payload: preferences,
      meta: { type: matchmakingType },
    })
    dispatch({
      type: '@matchmaking/updatePreferences',
      payload: fetch<GetPreferencesPayload>(apiUrl`matchmakingPreferences/${matchmakingType}`, {
        method: 'post',
        body: JSON.stringify(preferences),
      }),
      meta: { type: preferences.matchmakingType },
    })
  }
}
