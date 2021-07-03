import { Immutable } from 'immer'
import { User, UserProfile } from '../../common/users/user-info'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface UserRequestInfo {
  /** Should be set to the current value of `window.performance.now()` when the request is made. */
  time: number
}

export interface UserState {
  /** A map of user ID -> user information. */
  byId: Map<number, User>
  /** A map of username -> user ID. */
  usernameToId: Map<string, number>
  /** A map of user ID -> user profile information. */
  idToProfile: Map<number, UserProfile>
  /**
   * The set of user IDs for which data is currently loading. This is intended to be used for
   * showing loading indicators and deduping requests.
   */
  idLoadsInProgress: Map<number, UserRequestInfo>
  /**
   * The set of usernames for which data is currently loading. This is intended to be used for
   * showing loading indicators and deduping requests.
   */
  usernameLoadsInProgress: Map<string, UserRequestInfo>
}

const DEFAULT_STATE: Immutable<UserState> = {
  byId: new Map(),
  usernameToId: new Map(),
  idToProfile: new Map(),
  idLoadsInProgress: new Map(),
  usernameLoadsInProgress: new Map(),
}

function updateUsers(state: UserState, users: User[]) {
  for (const user of users) {
    const userState = state.byId.get(user.id)
    if (userState) {
      if (userState.name !== user.name) {
        state.usernameToId.delete(userState.name)
        userState.name = user.name
      }
    } else {
      state.byId.set(user.id, { id: user.id, name: user.name })
    }

    state.usernameToId.set(user.name, user.id)
  }
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@auth/logIn'](state, action) {
    if (action.error) {
      return
    }

    const {
      payload: { user },
    } = action

    state.byId.set(user.id, { id: user.id, name: user.name })
    state.usernameToId.set(user.name, user.id)
  },

  ['@auth/loadCurrentSession'](state, action) {
    if (action.error) {
      return
    }

    const {
      payload: { user },
    } = action

    state.byId.set(user.id, { id: user.id, name: user.name })
    state.usernameToId.set(user.name, user.id)
  },

  ['@chat/retrieveUserList'](state, action) {
    if (action.error) {
      return
    }

    updateUsers(state, action.payload.users)
  },

  ['@chat/updateJoin'](state, action) {
    updateUsers(state, [action.payload.user])
  },

  ['@ladder/getRankings'](state, action) {
    if (action.error) {
      return
    }

    updateUsers(state, action.payload.users)
  },

  ['@profile/getUserProfile'](state, { payload: { user, profile } }) {
    updateUsers(state, [user])
    state.idToProfile.set(profile.userId, profile)
  },

  ['@whispers/loadMessageHistory'](state, action) {
    if (action.error) {
      return
    }

    updateUsers(state, action.payload.users)
  },

  ['@whispers/updateMessage'](state, action) {
    updateUsers(state, action.payload.users)
  },
})
