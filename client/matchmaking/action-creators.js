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

export const findMatch = (type, race, alternateRace, preferredMaps) =>
  createSiteSocketAction(MATCHMAKING_FIND_BEGIN, MATCHMAKING_FIND, '/matchmaking/find', {
    type,
    race,
    alternateRace,
    preferredMaps,
  })

export const cancelFindMatch = () =>
  createSiteSocketAction(MATCHMAKING_CANCEL_BEGIN, MATCHMAKING_CANCEL, '/matchmaking/cancel')

export const acceptMatch = () =>
  createSiteSocketAction(MATCHMAKING_ACCEPT_BEGIN, MATCHMAKING_ACCEPT, '/matchmaking/accept')

// TODO(2Pac): This can be cached
export function getCurrentMapPool(type) {
  return dispatch => {
    dispatch({
      type: MATCHMAKING_GET_CURRENT_MAP_POOL_BEGIN,
      meta: { type },
    })
    dispatch({
      type: MATCHMAKING_GET_CURRENT_MAP_POOL,
      payload: fetch('/api/1/matchmakingMapPools/' + encodeURIComponent(type) + '/current'),
      meta: { type },
    })
  }
}
