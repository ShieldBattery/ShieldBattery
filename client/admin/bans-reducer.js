import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  ADMIN_BAN_USER,
  ADMIN_GET_BAN_HISTORY_BEGIN,
  ADMIN_GET_BAN_HISTORY,
} from '../actions'

export const Ban = new Record({
  startTime: null,
  endTime: null,
  bannedBy: null,
  reason: null,
})
export const BanHistory = new Record({
  bans: new List(),

  lastUpdated: 0,
  isRequesting: false,
  lastError: null,
})
export const BanState = new Record({
  users: new Map(),
})

export default keyedReducer(new BanState(), {
  [ADMIN_GET_BAN_HISTORY_BEGIN](state, action) {
    return state.updateIn([ 'users', action.payload.username ],
        new BanHistory(),
        b => b.set('isRequesting', true))
  },

  [ADMIN_GET_BAN_HISTORY](state, action) {
    if (action.error) {
      const data = {
        lastError: action.payload,
        isRequesting: false,
      }
      return state.updateIn([ 'users', action.meta.username ],
          new BanHistory(),
          b => b.merge(data))
    }

    const data = {
      bans: new List(action.payload.map(ban => new Ban(ban))),
      lastUpdated: Date.now(),
      lastError: null,
      isRequesting: false,
    }
    return state.updateIn([ 'users', action.meta.username ],
        new BanHistory(),
        b => b.merge(data))
  },

  [ADMIN_BAN_USER](state, action) {
    if (action.error) {
      const data = {
        lastError: action.payload,
        isRequesting: false,
      }
      return state.updateIn([ 'users', action.meta.username ],
          new BanHistory(),
          b => b.merge(data))
    }

    const banHistory = state.users.get(action.meta.username)
    const data = {
      bans: banHistory.bans.push(new Ban(action.payload)),
      lastUpdated: Date.now(),
      lastError: null,
      isRequesting: false,
    }
    return state.updateIn([ 'users', action.meta.username ],
        new BanHistory(),
        b => b.merge(data))
  },
})
