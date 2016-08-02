import { Record } from 'immutable'
import {
  BETA_CREATE_INVITE_BEGIN,
  BETA_CREATE_INVITE,
} from '../actions'

export const Signups = new Record({
  isCreating: false,
  lastError: null,
})

const handlers = {
  [BETA_CREATE_INVITE_BEGIN](state, action) {
    return (state.withMutations(s =>
      s.set('isCreating', true)
        .set('lastError', null)
    ))
  },

  [BETA_CREATE_INVITE](state, action) {
    if (action.error) {
      return (state.withMutations(s =>
        s.set('isCreating', false)
          .set('lastError', action.payload)
      ))
    }

    return (state.withMutations(s =>
      s.set('isCreating', false)
        .set('lastError', null)
    ))
  },
}

export default function permissionsReducer(state = new Signups(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
