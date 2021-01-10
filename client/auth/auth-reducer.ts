import keyedReducer from '../reducers/keyed-reducer'
import {
  AccountUpdateSuccess,
  AuthActions,
  AuthChangeBegin,
  LoadCurrentSessionSuccess,
  LogInFailure,
  LogInSuccess,
  LogOutSuccess,
  SendVerificationEmailFailure,
  SignUpFailure,
  SignUpSuccess,
  VerifyEmailFailure,
  VerifyEmailSuccess,
} from './actions'
import { Auth, Permissions, User } from './auth-records'
import type { UserInfo } from '../../common/users/user-info'

type State = InstanceType<typeof Auth>
type AuthErrors = Extract<AuthActions, { error: true }>
type AuthErrorable = Extract<AuthActions, { error: true } | { error?: false }>

function begin(state: State, action: AuthChangeBegin) {
  return state.withMutations(s => s.set('authChangeInProgress', true).set('lastFailure', null))
}

function logInSuccess(state: State, action: { payload: UserInfo }) {
  const { user, permissions } = action.payload
  return new Auth({
    user: new User(user),
    permissions: new Permissions(permissions),
    emailVerified: user.emailVerified,
  })
}

function logOutSuccess(state: State, action: LogOutSuccess) {
  return new Auth()
}

function handleError(state: State, action: AuthErrors) {
  return state.withMutations(s =>
    s.set('authChangeInProgress', false).set('lastFailure', {
      ...action.meta,
      err: action.payload.body ? action.payload.body.error : 'Connection error',
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
    s.set('authChangeInProgress', false).set('lastFailure', null).set('emailVerified', true),
  )
}

function handleVerifyEmailError(state: State, action: VerifyEmailFailure) {
  const { body, res } = action.payload
  let errMessage = body ? body.error : 'Verification error'
  if (res.status === 400) {
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

function handleSendVerificationEmailError(state: State, action: SendVerificationEmailFailure) {
  const { body, res } = action.payload
  let errMessage = body ? body.error : 'Sending verification error'
  if (res.status === 409) {
    errMessage =
      'The provided email is over verification limit. Please use a different email ' +
      'address or try again later.'
  }

  return state.withMutations(s =>
    s.set('authChangeInProgress', false).set('lastFailure', {
      ...action.meta,
      err: errMessage,
    }),
  )
}

function accountUpdate(state: State, action: AccountUpdateSuccess) {
  const { email, emailVerified } = action.payload
  return state
    .set('authChangeInProgress', false)
    .set('lastFailure', null)
    .set('emailVerified', emailVerified)
    .setIn(['user', 'email'], email)
}

const logInSplitter = (
  state: State,
  action: LogInSuccess | LogInFailure | SignUpSuccess | SignUpFailure | LoadCurrentSessionSuccess,
) => (!action.error ? logInSuccess(state, action) : handleError(state, action))

export default keyedReducer(new Auth(), {
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
  ['@auth/sendVerificationEmail']: (state, action) =>
    !action.error ? noOpOrError(state, action) : handleSendVerificationEmailError(state, action),
  ['@auth/startPasswordReset']: noOpOrError,
  ['@auth/emailVerified']: state => state.set('emailVerified', true),
  ['@auth/verifyEmail']: (state, action) =>
    !action.error ? emailVerified(state, action) : handleVerifyEmailError(state, action),
})
