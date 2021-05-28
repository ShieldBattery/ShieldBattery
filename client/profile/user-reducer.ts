import { Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'

export class UserRecord extends Record({
  id: 0,
  username: '',
  /**
   * Should be set to the current value of `window.performance.now()` when the request to update
   * the user was made.
   */
  lastUpdated: 0,
}) {}

export class UserRequestInfo extends Record({
  /** Should be set to the current value of `window.performance.now()` when the request is made. */
  time: 0,
}) {}

export class UserState extends Record({
  /** A map of user ID -> user information. */
  byId: Map<number, UserRecord>(),
  /** A map of username -> user ID. */
  usernameToId: Map<string, number>(),
  /**
   * The set of user IDs for which data is currently loading. This is intended to be used for
   * showing loading indicators and deduping requests.
   */
  idLoadsInProgress: Map<number, UserRequestInfo>(),
  /**
   * The set of usernames for which data is currently loading. This is intended to be used for
   * showing loading indicators and deduping requests.
   */
  usernameLoadsInProgress: Map<string, UserRequestInfo>(),
}) {}

export default keyedReducer(new UserState(), {
  ['@auth/logIn'](state, action) {
    if (action.error) {
      return state
    }

    const {
      payload: { user },
      meta: { time },
    } = action

    return state
      .setIn(
        ['byId', user.id],
        new UserRecord({ id: user.id, username: user.name, lastUpdated: time }),
      )
      .setIn(['usernameToId', user.name], user.id)
  },

  ['@auth/loadCurrentSession'](state, action) {
    if (action.error) {
      return state
    }

    const {
      payload: { user },
      meta: { time },
    } = action
    return state
      .setIn(
        ['byId', user.id],
        new UserRecord({ id: user.id, username: user.name, lastUpdated: time }),
      )
      .setIn(['usernameToId', user.name], user.id)
  },
})
