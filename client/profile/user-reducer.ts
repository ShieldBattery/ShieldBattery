import { Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'

export class UserRecord extends Record({
  id: 0,
  name: '',
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
    } = action

    return state
      .setIn(['byId', user.id], new UserRecord({ id: user.id, name: user.name }))
      .setIn(['usernameToId', user.name], user.id)
  },

  ['@auth/loadCurrentSession'](state, action) {
    if (action.error) {
      return state
    }

    const {
      payload: { user },
    } = action
    return state
      .setIn(['byId', user.id], new UserRecord({ id: user.id, name: user.name }))
      .setIn(['usernameToId', user.name], user.id)
  },

  ['@ladder/getRankings'](state, action) {
    if (action.error) {
      return state
    }

    const {
      payload: { users },
    } = action

    const usernameToId = users.map<[name: string, id: number]>(u => [u.name, u.id])

    return (
      state
        .set(
          'byId',
          state.byId.withMutations(byId => {
            for (const user of users) {
              byId.update(user.id, (u = new UserRecord(user)) => u.set('name', user.name))
            }
          }),
        )
        // NOTE(tec27): This leaves unmatched usernames in the map. I don't think this should be an
        // issue because if we find another user with that name in the future, it'll overwrite to
        // the new ID. (Also, likely, we'd prevent people from changing to that name for some time
        // anyway)
        .mergeIn(['usernameToId'], Map(usernameToId))
    )
  },
})
