import { User } from '../../common/users/user-info'
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

const DEFAULT_STATE: UserState = {
  byId: new Map(),
  usernameToId: new Map(),
  idLoadsInProgress: new Map(),
  usernameLoadsInProgress: new Map(),
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

  ['@ladder/getRankings'](state, action) {
    if (action.error) {
      return
    }

    const {
      payload: { users },
    } = action

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
  },
})
