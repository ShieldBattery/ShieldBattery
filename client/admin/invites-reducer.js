import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { ADMIN_GET_INVITES, ADMIN_ACCEPT_USER } from '../actions'

export const Signup = new Record({
  email: null,
  teamliquidName: null,
  os: null,
  browser: null,
  graphics: null,
  canHost: false,
  isAccepted: false,
  token: null,
})

export const InviteState = new Record({
  signups: new List(),
  byEmail: new Map(),
  total: 0,
  lastError: null,
  lastType: null,
})

export default keyedReducer(new InviteState(), {
  [ADMIN_GET_INVITES](state, action) {
    if (action.error) {
      return state.set('lastError', action.payload).set('lastType', action.meta.inviteeType)
    }

    const signups = new List(action.payload.invites.map(s => s.email))
    const byEmail = new Map(action.payload.invites.map(s => [s.email, new Signup(s)]))
    const data = {
      signups,
      byEmail,
      total: action.payload.total,
      lastError: null,
      lastType: action.meta.inviteeType,
    }

    return state.merge(data)
  },

  [ADMIN_ACCEPT_USER](state, action) {
    if (action.error) {
      return state.set('lastError', action.payload)
    }

    const acceptedUser = action.payload
    if (state.byEmail.has(acceptedUser.email)) {
      return state.setIn(['byEmail', acceptedUser.email], acceptedUser)
    } else {
      return state
    }
  },
})
