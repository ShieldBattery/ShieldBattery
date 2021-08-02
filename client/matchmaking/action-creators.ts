import { TypedIpcRenderer } from '../../common/ipc'
import {
  GetPreferencesPayload,
  MatchmakingMapPool,
  MatchmakingPreferences,
  MatchmakingType,
} from '../../common/matchmaking'
import { AssignedRaceChar, RaceChar } from '../../common/races'
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
      type: '@matchmaking/findMatchBegin',
      payload: params,
    })

    dispatch({
      type: '@matchmaking/findMatch',
      payload: fetch<void>(apiUrl`matchmaking/find`, {
        method: 'POST',
        body: JSON.stringify(params),
      }).then(() => ({ startTime: window.performance.now() })),
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
  return dispatch => {
    dispatch({
      type: '@matchmaking/getCurrentMapPoolBegin',
      payload: { type },
    })
    dispatch({
      type: '@matchmaking/getCurrentMapPool',
      payload: fetch<MatchmakingMapPool>(apiUrl`matchmakingMapPools/${type}/current`),
      meta: { type },
    })
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
