import { Map, Record } from 'immutable'
import {
  ADMIN_GET_PERMISSIONS_BEGIN,
  ADMIN_GET_PERMISSIONS,
  ADMIN_GET_PERMISSIONS_ERROR,
  ADMIN_SET_PERMISSIONS,
} from '../actions'

export const Perms = new Record({
  editPermissions: false,
  debug: false,
  acceptInvites: false,
})

export const Time = new Record({
  time: Date.now(),
})

export const Permissions = new Record({
  users: new Map(),
  lastUpdated: new Map(),
  requestingPermissions: false,
})

const handlers = {
  [ADMIN_GET_PERMISSIONS_BEGIN](state, action) {
    return state.set('requestingPermissions', true)
  },

  [ADMIN_GET_PERMISSIONS](state, action) {
    if (action.error) {
      // TODO(2Pac): handle error
    }

    const permissions = new Perms(action.payload)
    const username = action.meta.username
    return (state.withMutations(s =>
      s.set('requestingPermissions', false)
       .setIn(['users', username], permissions)
       .setIn(['lastUpdated', username], new Time())
    ))
  },

  [ADMIN_GET_PERMISSIONS_ERROR](state, action) {
    return state.set('requestingPermissions', false)
  },

  [ADMIN_SET_PERMISSIONS](state, action) {
    if (action.error) {
      // TODO(2Pac): handle error
    }
    // TODO(2Pac): display confirmation/error message, preferably in a snackbar/toast

    return state
  },
}

export default function permissionsReducer(state = new Permissions(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
