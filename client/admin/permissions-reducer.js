import { Map, Record } from 'immutable'
import {
  ADMIN_GET_PERMISSIONS,
  ADMIN_GET_PERMISSIONS_BEGIN,
  ADMIN_SET_PERMISSIONS,
} from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

export const Permissions = Record({
  editPermissions: false,
  debug: false,
  acceptInvites: false,
  editAllChannels: false,
  banUsers: false,
  manageMaps: false,
  manageMapPools: false,
  manageMatchmakingTimes: false,
  manageRallyPointServers: false,
  massDeleteMaps: false,
  moderateChatChannels: false,

  lastUpdated: 0,
  isRequesting: false,
  lastError: null,
})

export const PermissionState = Record({
  users: new Map(),
})

export default keyedReducer(new PermissionState(), {
  [ADMIN_GET_PERMISSIONS_BEGIN](state, action) {
    return state.updateIn(['users', action.payload.username], new Permissions(), p =>
      p.set('isRequesting', true),
    )
  },

  [ADMIN_GET_PERMISSIONS](state, action) {
    if (action.error) {
      const data = {
        lastError: action.payload,
        isRequesting: false,
      }
      return state.updateIn(['users', action.meta.username], new Permissions(), p => p.merge(data))
    }

    const data = {
      ...action.payload,
      lastUpdated: Date.now(),
      lastError: null,
      isRequesting: false,
    }
    return state.updateIn(['users', action.meta.username], new Permissions(), p => p.merge(data))
  },

  [ADMIN_SET_PERMISSIONS](state, action) {
    if (action.error) {
      const data = {
        lastError: action.payload,
        isRequesting: false,
      }
      return state.updateIn(['users', action.meta.username], new Permissions(), p => p.merge(data))
    }

    const data = {
      ...action.payload,
      lastUpdated: Date.now(),
      lastError: null,
      isRequesting: false,
    }
    return state.updateIn(['users', action.meta.username], new Permissions(), p => p.merge(data))
  },
})
