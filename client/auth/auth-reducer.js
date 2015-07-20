import Immutable from 'immutable'
import { AUTH_CHANGE_BEGIN, AUTH_LOG_IN, AUTH_LOG_OUT, AUTH_SIGN_UP } from '../actions'

const initialState = Immutable.Map({
  user: null,
  permissions: null,
  authChangeInProgress: false,
  lastFailure: null,
})

function begin(state, action) {
  return (state.withMutations(s =>
    s.set('authChangeInProgress', true)
      .set('lastFailure', null)
  ))
}

function logInSuccess(state, action) {
  const { user, permissions } = action.payload
  return (state.withMutations(s =>
    s.set('authChangeInProgress', false)
      .set('lastFailure', null)
      .set('user', Immutable.Map(user))
      .set('permissions', Immutable.Map(permissions))
  ))
}

function logOutSuccess(state, action) {
  return (state.withMutations(s =>
    s.set('authChangeInProgress', false)
      .set('lastFailure', null)
      .set('user', null)
      .set('permissions', null)
  ))
}

function handleError(state, action) {
  return (state.withMutations(s =>
    s.set('authChangeInProgress', false)
      .set('lastFailure', { ...action.meta, err: action.payload.body.error })
  ))
}

const logInSplitter = (state, action) => (!action.error ? logInSuccess : handleError)(state, action)
const handlers = {
  [AUTH_CHANGE_BEGIN]: begin,
  [AUTH_LOG_IN]: logInSplitter,
  [AUTH_LOG_OUT]: (state, action) => (!action.error ? logOutSuccess : handleError)(state, action),
  [AUTH_SIGN_UP]: logInSplitter,
}

export default function authReducer(state = initialState, action) {
  return handlers[action.type] ? handlers[action.type](state, action) : state
}
