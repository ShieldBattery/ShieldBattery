import { ReadonlyDeep } from 'type-fest'
import { SbPermissions } from '../../common/users/permissions'
import { SelfUser } from '../../common/users/sb-user'
import { ClientSessionInfo } from '../../common/users/session'
import { isFetchError } from '../network/fetch-errors'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import {
  AccountUpdateSuccess,
  AuthActions,
  AuthChangeBegin,
  LogOutSuccess,
  VerifyEmailSuccess,
} from './actions'

type AuthErrors = Extract<AuthActions, { error: true }>
type AuthErrorable = Extract<AuthActions, { error: true } | { error?: false }>

export interface AuthState {
  authChangeInProgress: boolean
  lastFailure: { reqId: string; err: string; code?: string } | undefined
  self?: {
    user: SelfUser
    permissions: SbPermissions
    sessionId: string
  }
}

const DEFAULT_STATE: ReadonlyDeep<AuthState> = {
  authChangeInProgress: false,
  lastFailure: undefined,
  self: undefined,
}

function begin(state: AuthState, action: AuthChangeBegin) {
  state.authChangeInProgress = true
  state.lastFailure = undefined
}

function logInSuccess(state: AuthState, action: { payload: ClientSessionInfo }): AuthState {
  const { user, permissions, sessionId } = action.payload
  return {
    authChangeInProgress: false,
    lastFailure: undefined,
    self: {
      user: { ...user },
      permissions: { ...permissions },
      sessionId,
    },
  }
}

function logOutSuccess(state: AuthState, action: LogOutSuccess) {
  return DEFAULT_STATE
}

function handleError(state: AuthState, action: AuthErrors) {
  const { meta } = action
  if (!meta.reqId) {
    return state
  }

  state.authChangeInProgress = false
  state.lastFailure = {
    reqId: meta.reqId,
    err: action.payload.statusText ?? 'Connection error',
    code: isFetchError(action.payload) ? action.payload.code : undefined,
  }
  return state
}

function noOpOrError(state: AuthState, action: AuthErrorable) {
  if (!action.error) {
    state.authChangeInProgress = false
    state.lastFailure = undefined
    return state
  } else {
    return handleError(state, action)
  }
}

function emailVerified(state: AuthState, action: VerifyEmailSuccess) {
  state.authChangeInProgress = false
  state.lastFailure = undefined
  state.self!.user.emailVerified = true

  return state
}

function accountUpdate(state: AuthState, action: AccountUpdateSuccess) {
  const user = action.payload
  state.authChangeInProgress = false
  state.lastFailure = undefined
  state.self!.user = { ...user }
  return state
}

export default immerKeyedReducer<ReadonlyDeep<AuthState>>(DEFAULT_STATE, {
  ['@auth/accountUpdate']: (state, action) =>
    !action.error ? accountUpdate(state, action) : handleError(state, action),
  ['@auth/changeBegin']: begin,
  ['@auth/logOut']: (state, action) =>
    !action.error ? logOutSuccess(state, action) : handleError(state, action),
  ['@auth/loadCurrentSession']: logInSuccess,
  ['@auth/resetPassword']: noOpOrError,
  ['@auth/recoverUsername']: noOpOrError,
  ['@auth/startPasswordReset']: noOpOrError,
  ['@auth/emailVerified']: state => {
    state.self!.user.emailVerified = true
  },
  ['@auth/verifyEmail']: (state, action) =>
    !action.error ? emailVerified(state, action) : handleError(state, action),
  ['@auth/acceptPolicies'](state, action) {
    if (action.error) {
      return
    } else {
      state.self!.user = { ...action.payload.user }
    }
  },
  ['@auth/changeLanguage'](state, action) {
    state.self!.user = { ...action.payload.user }
  },
  ['@auth/permissionsChanged'](state, action) {
    state.self!.permissions = { ...action.payload.permissions }
  },
})
