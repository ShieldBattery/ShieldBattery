import { SbPermissions } from '../../common/users/permissions'
import {
  AcceptPoliciesResponse,
  ChangeLanguagesResponse,
  SbUserId,
  SelfUser,
} from '../../common/users/sb-user'
import { ClientSessionInfo } from '../../common/users/session'
import { BaseFetchFailure } from '../network/fetch-errors'

export type AuthActions =
  | AuthChangeBegin
  | AccountUpdateSuccess
  | AccountUpdateFailure
  | LogOutSuccess
  | LogOutFailure
  | ResetPasswordSuccess
  | ResetPasswordFailure
  | RecoverUsernameSuccess
  | RecoverUsernameFailure
  | StartPasswordResetSuccess
  | StartPasswordResetFailure
  | LoadCurrentSessionSuccess
  | VerifyEmailSuccess
  | VerifyEmailFailure
  | EmailVerified
  | AcceptPoliciesSuccess
  | AcceptPoliciesFailure
  | ChangeLanguage
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

/**
 * Loading the current active user session from the server succeeded and the returned user is now
 * active.
 */
export interface LoadCurrentSessionSuccess {
  type: '@auth/loadCurrentSession'
  payload: ClientSessionInfo
}

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

/** The language was changed by the current user. */
export interface ChangeLanguage {
  type: '@auth/changeLanguage'
  payload: ChangeLanguagesResponse
}

export interface PermissionsChanged {
  type: '@auth/permissionsChanged'
  payload: {
    userId: SbUserId
    permissions: SbPermissions
  }
}
