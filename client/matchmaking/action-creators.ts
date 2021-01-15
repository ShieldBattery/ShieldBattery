import createSiteSocketAction from '../action-creators/site-socket-action-creator'
import fetch from '../network/fetch'
import {
  MATCHMAKING_ACCEPT_BEGIN,
  MATCHMAKING_ACCEPT,
  MATCHMAKING_CANCEL_BEGIN,
  MATCHMAKING_CANCEL,
  MATCHMAKING_FIND_BEGIN,
  MATCHMAKING_FIND,
  MATCHMAKING_GET_CURRENT_MAP_POOL_BEGIN,
  MATCHMAKING_GET_CURRENT_MAP_POOL,
} from '../actions'
import { MatchmakingType } from '../../common/matchmaking'
import { ThunkAction } from '../dispatch-registry'
import { RaceChar } from '../../common/races'
import { GetPreferencesPayload, MatchmakingPreferences } from './actions'

export const findMatch = (
  type: MatchmakingType,
  race: RaceChar,
  useAlternateRace: boolean,
  alternateRace: RaceChar,
  preferredMaps: string[],
) =>
  createSiteSocketAction(MATCHMAKING_FIND_BEGIN, MATCHMAKING_FIND, '/matchmaking/find', {
    type,
    race,
    useAlternateRace,
    alternateRace,
    preferredMaps,
  })

export const cancelFindMatch = () =>
  createSiteSocketAction(MATCHMAKING_CANCEL_BEGIN, MATCHMAKING_CANCEL, '/matchmaking/cancel')

export const acceptMatch = () =>
  createSiteSocketAction(MATCHMAKING_ACCEPT_BEGIN, MATCHMAKING_ACCEPT, '/matchmaking/accept')

// TODO(2Pac): This can be cached
export function getCurrentMapPool(type: MatchmakingType): ThunkAction {
  return dispatch => {
    dispatch({
      type: MATCHMAKING_GET_CURRENT_MAP_POOL_BEGIN,
      meta: { type },
    } as any)
    dispatch({
      type: MATCHMAKING_GET_CURRENT_MAP_POOL,
      payload: fetch('/api/1/matchmakingMapPools/' + encodeURIComponent(type) + '/current'),
      meta: { type },
    } as any)
  }
}

export function getMatchmakingPreferences(matchmakingType: MatchmakingType): ThunkAction {
  return dispatch => {
    dispatch({ type: '@matchmaking/getPreferencesBegin', payload: { type: matchmakingType } })
    dispatch({
      type: '@matchmaking/getPreferences',
      payload: fetch<GetPreferencesPayload>(
        `/api/1/matchmakingPreferences?matchmakingType=${matchmakingType}`,
      ),
      meta: { type: matchmakingType },
    })
  }
}

export function updateMatchmakingPreferences(preferences: MatchmakingPreferences): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@matchmaking/updatePreferencesBegin',
      payload: preferences,
    })
    dispatch({
      type: '@matchmaking/updatePreferences',
      payload: fetch<GetPreferencesPayload>('/api/1/matchmakingPreferences', {
        method: 'post',
        body: JSON.stringify(preferences),
      }),
      meta: { type: preferences.matchmakingType },
    })
  }
}
