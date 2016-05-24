import siteSocket from '../network/site-socket'
import {
  MATCHMAKING_FIND_BEGIN,
  MATCHMAKING_FIND
} from '../actions'

export function findMatch(type) {
  return dispatch => {
    const params = { type }
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
