import siteSocket from '../network/site-socket'
import {
  MATCHMAKING_CANCEL_BEGIN,
  MATCHMAKING_CANCEL,
  MATCHMAKING_FIND_BEGIN,
  MATCHMAKING_FIND,
  MATCHMAKING_RESTART_STATE
} from '../actions'

export function findMatch(type, race) {
  return dispatch => {
    const params = { type, race }
    dispatch({
      type: MATCHMAKING_FIND_BEGIN,
      payload: params,
    })
    dispatch({
      type: MATCHMAKING_FIND,
      payload: siteSocket.invoke('/matchmaking/find', params),
      meta: params,
    })
  }
}

export function cancelFindMatch(type) {
  return dispatch => {
    const params = { type }
    dispatch({
      type: MATCHMAKING_CANCEL_BEGIN,
      payload: params,
    })
    dispatch({
      type: MATCHMAKING_CANCEL,
      payload: siteSocket.invoke('/matchmaking/cancel', params),
      meta: params,
    })
  }
}

export function resetMatchmakingState() {
  return {
    type: MATCHMAKING_RESTART_STATE
  }
}
