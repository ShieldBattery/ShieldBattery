import { Map, Record } from 'immutable'
import {
  ADMIN_GET_INVITES,
  ADMIN_ACCEPT_USER,
} from '../actions'

export const Invite = new Record({
  email: null,
  teamliquidName: null,
  os: null,
  browser: null,
  graphics: null,
  canHost: false,
  isAccepted: false,
})

export const Invites = new Record({
  signups: new Map(),
})

const handlers = {
  [ADMIN_GET_INVITES](state, action) {
    if (action.error) {
      // TODO(2Pac): handle error
      return state
    }

    const invites = action.payload
    let invite
    return state.withMutations(s => {
      invites.forEach(invitee => {
        invite = new Invite(invitee)
        s.setIn(['signups', invitee.email], invite)
      })
    })
  },

  [ADMIN_ACCEPT_USER](state, action) {
    if (action.error) {
      // TODO(2Pac): handle error
      return state
    }

    const acceptedUser = action.payload
    if (state.signups.has(acceptedUser.email)) {
      return state.setIn(['signups', acceptedUser.email], acceptedUser)
    } else {
      return state
    }
  },
}

export default function lobbyReducer(state = new Invites(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
