import { ClientSessionInfo } from '../../common/users/session'
import { keyedReducer } from '../reducers/keyed-reducer'
import {
  AccountUpdateSuccess,
  AuthActions,
  AuthChangeBegin,
  LoadCurrentSessionSuccess,
  LogInFailure,
  LogInSuccess,
  LogOutSuccess,
  SignUpFailure,
  SignUpSuccess,
  VerifyEmailFailure,
  VerifyEmailSuccess,
} from './actions'
import { AuthState, PermissionsRecord, SelfUserRecord } from './auth-records'

type State = InstanceType<typeof AuthState>
type AuthErrors = Extract<AuthActions, { error: true }>
type AuthErrorable = Extract<AuthActions, { error: true } | { error?: false }>

function begin(state: State, action: AuthChangeBegin) {
  return state.withMutations(s => s.set('authChangeInProgress', true).set('lastFailure', null))
}

function logInSuccess(state: State, action: { payload: ClientSessionInfo }) {
  const { user, permissions } = action.payload
  return new AuthState({
    user: new SelfUserRecord(user),
    permissions: new PermissionsRecord(permissions),
  })
}

function logOutSuccess(state: State, action: LogOutSuccess) {
  return new AuthState()
}

function handleError(state: State, action: AuthErrors) {
  const { meta } = action
  if (!meta.reqId) {
    return state
  }
  return state.withMutations(s =>
    s.set('authChangeInProgress', false).set('lastFailure', {
      reqId: meta.reqId,
      err: action.payload.statusText ?? 'Connection error',
    }),
  )
}

function noOpOrError(state: State, action: AuthErrorable) {
  if (!action.error) {
    return state.set('authChangeInProgress', false).set('lastFailure', null)
  } else {
    return handleError(state, action)
  }
}

function emailVerified(state: State, action: VerifyEmailSuccess) {
  return state.withMutations(s =>
    s
      .set('authChangeInProgress', false)
      .set('lastFailure', null)
      .setIn(['user', 'emailVerified'], true),
  )
}

function handleVerifyEmailError(state: State, action: VerifyEmailFailure) {
  const { status, statusText } = action.payload
  let errMessage = statusText ?? 'Verification error'
  if (status === 400) {
    errMessage = `The provided email or verification code is not valid. If the verification code
      matches the one you were emailed, it may have expired. Please request a new verification
      email and try again.`
  }

  return state.withMutations(s =>
    s.set('authChangeInProgress', false).set('lastFailure', {
      ...action.meta,
      err: errMessage,
    }),
  )
}

function accountUpdate(state: State, action: AccountUpdateSuccess) {
  const user = action.payload
  return state
    .set('authChangeInProgress', false)
    .set('lastFailure', null)
    .set('user', new SelfUserRecord(user))
}

const logInSplitter = (
  state: State,
  action: LogInSuccess | LogInFailure | SignUpSuccess | SignUpFailure | LoadCurrentSessionSuccess,
) => (!action.error ? logInSuccess(state, action) : handleError(state, action))

export default keyedReducer(new AuthState(), {
  ['@auth/accountUpdate']: (state, action) =>
    !action.error ? accountUpdate(state, action) : handleError(state, action),
  ['@auth/changeBegin']: begin,
  ['@auth/logIn']: logInSplitter,
  ['@auth/logOut']: (state, action) =>
    !action.error ? logOutSuccess(state, action) : handleError(state, action),
  ['@auth/signUp']: logInSplitter,
  ['@auth/loadCurrentSession']: (state, action) =>
    !action.error ? logInSuccess(state, action) : state.set('authChangeInProgress', false),
  ['@auth/resetPassword']: noOpOrError,
  ['@auth/recoverUsername']: noOpOrError,
  ['@auth/startPasswordReset']: noOpOrError,
  ['@auth/emailVerified']: state => state.setIn(['user', 'emailVerified'], true),
  ['@auth/verifyEmail']: (state, action) =>
    !action.error ? emailVerified(state, action) : handleVerifyEmailError(state, action),
  ['@auth/acceptPolicies'](state, action) {
    if (action.error) {
      return state
    } else {
      return state.set('user', new SelfUserRecord(action.payload.user))
    }
  },
})
