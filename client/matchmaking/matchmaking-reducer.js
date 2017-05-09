import { Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  MATCHMAKING_ACCEPT,
  MATCHMAKING_CANCEL,
  MATCHMAKING_FIND,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
  MATCHMAKING_UPDATE_MATCH_ACCEPTED,
  MATCHMAKING_UPDATE_MATCH_FOUND,
  MATCHMAKING_UPDATE_MATCH_READY,
  NETWORK_SITE_CONNECTED,
} from '../actions'

const Match = new Record({
  numPlayers: 0,
  acceptedPlayers: 0,
})
export const MatchmakingState = new Record({
  isFinding: false,
  hasAccepted: false,
  acceptTime: -1,
  failedToAccept: false,
  match: null,
})

export default keyedReducer(new MatchmakingState(), {
  [MATCHMAKING_ACCEPT](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    return state.set('hasAccepted', true)
  },

  [MATCHMAKING_CANCEL](state, action) {
    // TODO(tec27): handle errors, which might indicate you're currently still in the queue

    return new MatchmakingState()
  },

  [MATCHMAKING_FIND](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    return new MatchmakingState({
      isFinding: true,
    })
  },

  [MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED](state, action) {
    return state.set('failedToAccept', true)
  },

  [MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME](state, action) {
    return state.set('acceptTime', action.payload)
  },

  [MATCHMAKING_UPDATE_MATCH_FOUND](state, action) {
    return (state
      .set('match', new Match({ numPlayers: action.payload.numPlayers }))
      .set('isFinding', false)
      .set('hasAccepted', false)
    )
  },

  [MATCHMAKING_UPDATE_MATCH_ACCEPTED](state, action) {
    return state.setIn(['match', 'acceptedPlayers'], action.payload.acceptedPlayers)
  },

  [MATCHMAKING_UPDATE_MATCH_READY](state, action) {
    const { players } = action.payload
    return state.setIn(['match', 'acceptedPlayers'], Object.keys(players).length)
  },

  [NETWORK_SITE_CONNECTED](state, action) {
    return new MatchmakingState()
  }
})
