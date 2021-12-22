import { SbPermissions } from '../../common/users/permissions'
import { ClientSessionInfo } from '../../common/users/session'
import { AcceptPoliciesResponse, SbUserId, SelfUser } from '../../common/users/user-info'
import { BaseFetchFailure } from '../network/fetch-errors'

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
  | StartPasswordResetSuccess
  | StartPasswordResetFailure
  | SignUpSuccess
  | SignUpFailure
  | LoadCurrentSessionSuccess
  | LoadCurrentSessionFailure
  | VerifyEmailSuccess
  | VerifyEmailFailure
  | EmailVerified
  | AcceptPoliciesSuccess
  | AcceptPoliciesFailure
  | PermissionsChanged

interface BaseAuthSuccess<T extends string, P = void> {
  type: T
  meta: {
    reqId: string
    /** Should be set to the current value of `window.performance.now()`. */
    time: number
  }
  // NOTE(tec27): This makes it possible to narrow types based on this field
  error?: false
  payload: P
}

interface BaseAuthFailure<T extends string> extends BaseFetchFailure<T> {
  meta: {
    reqId: string
    /** Should be set to the current value of `window.performance.now()`. */
    time: number
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
export type AccountUpdateSuccess = BaseAuthSuccess<'@auth/accountUpdate', SelfUser>
/**
 * The attempt to update the current user account's information failed.
 */
export type AccountUpdateFailure = BaseAuthFailure<'@auth/accountUpdate'>

/**
 * Logging into the user account was successful.
 */
export type LogInSuccess = BaseAuthSuccess<'@auth/logIn', ClientSessionInfo>
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

/** Initiating a password reset for a user was successful. */
export type StartPasswordResetSuccess = BaseAuthSuccess<'@auth/startPasswordReset'>
/** Initiating a password reset for a user failed. */
export type StartPasswordResetFailure = BaseAuthFailure<'@auth/startPasswordReset'>

/** Signing up for a new account succeeded and the user is now logged in. */
export type SignUpSuccess = BaseAuthSuccess<'@auth/signUp', ClientSessionInfo>
/** Signing up for a new account failed. */
export type SignUpFailure = BaseAuthFailure<'@auth/signUp'>

/**
 * Loading the current active user session from the server succeeded and the returned user is now
 * active.
 */
export type LoadCurrentSessionSuccess = BaseAuthSuccess<
  '@auth/loadCurrentSession',
  ClientSessionInfo
>
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

/** Various legal policies have been accepted successfully by the current user. */
export interface AcceptPoliciesSuccess {
  type: '@auth/acceptPolicies'
  payload: AcceptPoliciesResponse
  meta: Record<string, never>
  error?: false
}

/** Accepting legal policies failed. */
export interface AcceptPoliciesFailure extends BaseFetchFailure<'@auth/acceptPolicies'> {
  meta: Record<string, never>
}

export interface PermissionsChanged {
  type: '@auth/permissionsChanged'
  payload: {
    userId: SbUserId
    permissions: SbPermissions
  }
}
