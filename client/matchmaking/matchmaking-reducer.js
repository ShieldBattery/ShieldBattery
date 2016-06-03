import { Record } from 'immutable'
import {
  MATCHMAKING_CANCEL,
  MATCHMAKING_FIND,
  MATCHMAKING_UPDATE_MATCH_FOUND,
} from '../actions'

const Interval = new Record({
  low: 0,
  high: 0
})

const Opponent = new Record({
  name: null,
  interval: new Interval(),
  rating: 0,
  race: null
})

export const MatchmakingState = new Record({
  isFinding: false,
  type: null,
  race: 'r',
  opponent: null
})

const handlers = {
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
        .set('type', type)
        .set('race', race)
    ))
  },

  [MATCHMAKING_UPDATE_MATCH_FOUND](state, action) {
    return (state.withMutations(s =>
      s.set('isFinding', false)
        .set('type', action.payload.matchmakingType)
        .set('opponent', new Opponent(action.payload.opponent))
    ))
  },
}

export default function matchmakingReducer(state = new MatchmakingState(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
