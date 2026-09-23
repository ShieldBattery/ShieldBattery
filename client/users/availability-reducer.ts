import { Immutable } from 'immer'
import { AvailabilityInfo, DEFAULT_AVAILABILITY_INFO } from '../../common/users/availability'
import { SbUserId } from '../../common/users/sb-user-id'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface AvailabilityState {
  /**
   * The last known availability of other users, heard about from friend presence or from a shared
   * chat channel. An entry can outlive this client's view of that user once neither source covers
   * them any more, so readers only trust it for a user they currently know to be online (see
   * `useUserAvailability`).
   */
  byUserId: Map<SbUserId, AvailabilityInfo>
}

const DEFAULT_STATE: Immutable<AvailabilityState> = {
  byUserId: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@users/updateFriendAvailability'](state, { payload: { userId, info } }) {
    if (info) {
      state.byUserId.set(userId, info)
    } else {
      state.byUserId.delete(userId)
    }
  },

  // Channel events omit the availability of users who have the default, so anyone they announce
  // without one gets the default.

  ['@chat/initActiveUsers'](state, { payload: { activeUserIds, availabilities } }) {
    for (const userId of activeUserIds) {
      state.byUserId.set(userId, DEFAULT_AVAILABILITY_INFO)
    }
    for (const { userId, availability, statusMessage } of availabilities) {
      state.byUserId.set(userId, { availability, statusMessage })
    }
  },

  ['@chat/updateUserActive'](state, { payload: { userId, availability } }) {
    state.byUserId.set(userId, availability ?? DEFAULT_AVAILABILITY_INFO)
  },

  ['@chat/updateJoin'](state, { payload: { user, availability } }) {
    state.byUserId.set(user.id, availability ?? DEFAULT_AVAILABILITY_INFO)
  },

  ['@chat/updateUserAvailability'](state, { payload: { userId, availability } }) {
    state.byUserId.set(userId, availability)
  },

  ['@chat/updateUserOffline'](state, { payload: { userId } }) {
    state.byUserId.delete(userId)
  },

  ['@network/connect']() {
    return DEFAULT_STATE
  },

  ['@auth/logOut']() {
    return DEFAULT_STATE
  },
})
