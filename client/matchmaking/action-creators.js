import createSiteSocketAction from '../action-creators/site-socket-action-creator'
import {
  MATCHMAKING_ACCEPT_BEGIN,
  MATCHMAKING_ACCEPT,
  MATCHMAKING_CANCEL_BEGIN,
  MATCHMAKING_CANCEL,
  MATCHMAKING_FIND_BEGIN,
  MATCHMAKING_FIND,
  MATCHMAKING_RESTART_STATE
} from '../actions'


export const findMatch = (type, race) => createSiteSocketAction(MATCHMAKING_FIND_BEGIN,
    MATCHMAKING_FIND, '/matchmaking/find', { type, race })

export const cancelFindMatch = type => createSiteSocketAction(MATCHMAKING_CANCEL_BEGIN,
    MATCHMAKING_CANCEL, '/matchmaking/cancel', { type })

export const acceptMatch = matchId => createSiteSocketAction(MATCHMAKING_ACCEPT_BEGIN,
    MATCHMAKING_ACCEPT, '/matchmaking/accept', { matchId })

export function resetMatchmakingState() {
  return {
    type: MATCHMAKING_RESTART_STATE
  }
}
