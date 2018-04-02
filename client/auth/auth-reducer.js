import {
  AUTH_CHANGE_BEGIN,
  AUTH_LOG_IN,
  AUTH_LOG_OUT,
  AUTH_RESET_PASSWORD,
  AUTH_RETRIEVE_USERNAME,
  AUTH_SIGN_UP,
  AUTH_START_PASSWORD_RESET,
  AUTH_UPDATE,
  AUTH_UPDATE_EMAIL_VERIFIED,
} from '../actions'
import { Auth, Permissions, User } from './auth-records'

const initialState = new Auth()

function begin(state, action) {
  return state.withMutations(s => s.set('authChangeInProgress', true).set('lastFailure', null))
}

function logInSuccess(state, action) {
  const { user, permissions } = action.payload
  return new Auth({
    user: new User(user),
    permissions: new Permissions(permissions),
    emailVerified: user.emailVerified,
  })
}

function logOutSuccess(state, action) {
  return new Auth()
}

function handleError(state, action) {
  return state.withMutations(s =>
    s.set('authChangeInProgress', false).set('lastFailure', {
      ...action.meta,
      err: action.payload.body ? action.payload.body.error : 'Connection error',
    }),
  )
}

function noOpOrError(state, action) {
  if (!action.error) {
    return state.set('authChangeInProgress', false).set('lastFailure', null)
  } else {
    return handleError(state, action)
  }
}

function emailVerified(state, action) {
  return state.set('emailVerified', true)
}

const logInSplitter = (state, action) => (!action.error ? logInSuccess : handleError)(state, action)
const handlers = {
  [AUTH_CHANGE_BEGIN]: begin,
  [AUTH_LOG_IN]: logInSplitter,
  [AUTH_LOG_OUT]: (state, action) => (!action.error ? logOutSuccess : handleError)(state, action),
  [AUTH_SIGN_UP]: logInSplitter,
  [AUTH_UPDATE]: (state, action) =>
    !action.error ? logInSuccess(state, action) : state.set('authChangeInProgress', false),
  [AUTH_RESET_PASSWORD]: noOpOrError,
  [AUTH_RETRIEVE_USERNAME]: noOpOrError,
  [AUTH_START_PASSWORD_RESET]: noOpOrError,
  [AUTH_UPDATE_EMAIL_VERIFIED]: emailVerified,
}

export default function authReducer(state = initialState, action) {
  return handlers[action.type] ? handlers[action.type](state, action) : state
}
