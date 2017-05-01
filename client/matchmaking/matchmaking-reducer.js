import { Map, Record } from 'immutable'
import {
  MATCHMAKING_ACCEPT,
  MATCHMAKING_CANCEL,
  MATCHMAKING_FIND,
  MATCHMAKING_RESTART_STATE,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
  MATCHMAKING_UPDATE_MATCH_ACCEPTED,
  MATCHMAKING_UPDATE_MATCH_FOUND,
  MATCHMAKING_UPDATE_MATCH_READY,
} from '../actions'

const Match = new Record({
  id: null,
  type: null,
  players: new Map(),
  acceptedPlayers: 0
})
export const MatchmakingState = new Record({
  isFinding: false,
  hasAccepted: false,
  acceptTime: -1,
  race: 'r',
  match: new Match(),
})

const handlers = {
  [MATCHMAKING_ACCEPT](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    return state.set('hasAccepted', true)
  },

  [MATCHMAKING_CANCEL](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    return state.set('isFinding', false)
  },

  [MATCHMAKING_FIND](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    const { type, race } = action.meta
    return (state.withMutations(s =>
      s.set('isFinding', true)
        .set('hasAccepted', false)
        .set('race', race)
        .setIn(['match', 'type'], type)
    ))
  },

  [MATCHMAKING_RESTART_STATE](state, action) {
    return new MatchmakingState()
  },

  [MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME](state, action) {
    return state.set('acceptTime', action.payload)
  },

  [MATCHMAKING_UPDATE_MATCH_FOUND](state, action) {
    return (state.withMutations(s =>
      s.set('isFinding', false)
        .setIn(['match', 'id'], action.payload.matchId)
        .setIn(['match', 'acceptedPlayers'], 0)
    ))
  },

  [MATCHMAKING_UPDATE_MATCH_ACCEPTED](state, action) {
    return state.setIn(['match', 'acceptedPlayers'], state.match.acceptedPlayers + 1)
  },

  [MATCHMAKING_UPDATE_MATCH_READY](state, action) {
    const { players } = action.payload

    return state.setIn(['match', 'acceptedPlayers'], Object.keys(players).length)
      .setIn(['match', 'players'], players)
  },
}

export default function matchmakingReducer(state = new MatchmakingState(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
