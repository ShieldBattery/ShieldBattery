import { UserInfo } from '../../common/users/user-info'

export type AuthActions =
  | AuthChangeBegin
  | AccountUpdateSuccess
  | AccountUpdateFailure
  | LogInSuccess
  | LogInFailure
  | LogOutSuccess
  | LogOutFailure
  | ResetPasswordSuccess
  | ResetPasswordFailure
  | RecoverUsernameSuccess
  | RecoverUsernameFailure
  | SendVerificationEmailSuccess
  | SendVerificationEmailFailure
  | StartPasswordResetSuccess
  | StartPasswordResetFailure
  | SignUpSuccess
  | SignUpFailure
  | LoadCurrentSessionSuccess
  | LoadCurrentSessionFailure
  | VerifyEmailSuccess
  | VerifyEmailFailure
  | EmailVerified

interface BaseAuthSuccess<T extends string, P = void> {
  type: T
  meta: {
    reqId: string
  }
  // NOTE(tec27): This makes it possible to narrow types based on this field
  error?: false
  payload: P
}

interface BaseAuthFailure<T extends string> {
  type: T
  meta: {
    reqId: string
  }
  error: true
  payload: {
    body?: {
      // TODO(tec27): This has more things on it I believe?
      error: string
    }
    res: {
      // TODO(tec27): This has more things on it I believe?
      status: number
    }
  }
}

/**
 * A request is beginning to make a change to the current user's account. `reqId` can be used to
 * track results for this request.
 */
export interface AuthChangeBegin {
  type: '@auth/changeBegin'
  payload: {
    reqId: string
  }
}

/**
 * The current user's account information was updated successfully.
 */
export type AccountUpdateSuccess = BaseAuthSuccess<
  '@auth/accountUpdate',
  { email: string; emailVerified: boolean }
>
/**
 * The attempt to update the current user account's information failed.
 */
export type AccountUpdateFailure = BaseAuthFailure<'@auth/accountUpdate'>

/**
 * Logging into the user account was successful.
 */
export type LogInSuccess = BaseAuthSuccess<'@auth/logIn', UserInfo>
/**
 * Logging into the user account failed.
 */
export type LogInFailure = BaseAuthFailure<'@auth/logIn'>

/** Logging out of the user account was successful. */
export type LogOutSuccess = BaseAuthSuccess<'@auth/logOut'>
/** Logging out of the user account failed. */
export type LogOutFailure = BaseAuthFailure<'@auth/logOut'>

/** Resetting the user's password succeeded. */
export type ResetPasswordSuccess = BaseAuthSuccess<'@auth/resetPassword'>
/** Resetting the user's password failed. */
export type ResetPasswordFailure = BaseAuthFailure<'@auth/resetPassword'>

/** Recovering a user's name based on their email succeeded. */
export type RecoverUsernameSuccess = BaseAuthSuccess<'@auth/recoverUsername'>
/** Recovering a user's name based on their email failed. */
export type RecoverUsernameFailure = BaseAuthFailure<'@auth/recoverUsername'>

/** Sending a verification email for the current user succeeded. */
export type SendVerificationEmailSuccess = BaseAuthSuccess<'@auth/sendVerificationEmail'>
/** Sending a verification email for the current user failed. */
export type SendVerificationEmailFailure = BaseAuthFailure<'@auth/sendVerificationEmail'>

/** Initiating a password reset for a user was successful. */
export type StartPasswordResetSuccess = BaseAuthSuccess<'@auth/startPasswordReset'>
/** Initiating a password reset for a user failed. */
export type StartPasswordResetFailure = BaseAuthFailure<'@auth/startPasswordReset'>

/** Signing up for a new account succeeded and the user is now logged in. */
export type SignUpSuccess = BaseAuthSuccess<'@auth/signUp', UserInfo>
/** Signing up for a new account failed. */
export type SignUpFailure = BaseAuthFailure<'@auth/signUp'>

/**
 * Loading the current active user session from the server succeeded and the returned user is now
 * active.
 */
export type LoadCurrentSessionSuccess = BaseAuthSuccess<'@auth/loadCurrentSession', UserInfo>
/** Loading the current active user session from the server failed. */
export type LoadCurrentSessionFailure = BaseAuthFailure<'@auth/loadCurrentSession'>

/** The current user's email has been successfully verified. */
export type VerifyEmailSuccess = BaseAuthSuccess<'@auth/verifyEmail'>
/** Submitting email verification info for the current user failed. */
export type VerifyEmailFailure = BaseAuthFailure<'@auth/verifyEmail'>

/** The server has notified this client that the active user's email is now verified. */
export interface EmailVerified {
  type: '@auth/emailVerified'
  payload: void
}
