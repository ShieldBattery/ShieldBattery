import { SbPermissions } from '../../common/users/permissions'
import { SbUserId } from '../../common/users/sb-user-id'
import { ClientSessionInfo } from '../../common/users/session'
import { AcceptPoliciesResponse, ChangeLanguagesResponse } from '../../common/users/user-network'

export type AuthActions =
  | LogOut
  | LoadCurrentSession
  | EmailVerified
  | AcceptPolicies
  | ChangeLanguage
  | PermissionsChanged
  | SessionUnauthorized

export interface LogOut {
  type: '@auth/logOut'
  payload?: void
  error?: false
}

/**
 * Loading the current active user session from the server succeeded and the returned user is now
 * active.
 */
export interface LoadCurrentSession {
  type: '@auth/loadCurrentSession'
  payload: ClientSessionInfo
  error?: false
}

/** The server has notified this client that the active user's email is now verified. */
export interface EmailVerified {
  type: '@auth/emailVerified'
  payload?: void
  error?: false
}

/** Various legal policies have been accepted successfully by the current user. */
export interface AcceptPolicies {
  type: '@auth/acceptPolicies'
  payload: AcceptPoliciesResponse
  error?: false
}

/** The language was changed by the current user. */
export interface ChangeLanguage {
  type: '@auth/changeLanguage'
  payload: ChangeLanguagesResponse
  error?: false
}

export interface PermissionsChanged {
  type: '@auth/permissionsChanged'
  payload: {
    userId: SbUserId
    permissions: SbPermissions
  }
  error?: false
}

/** The server told us we were unauthorized (e.g. our session expired or was revoked). */
export interface SessionUnauthorized {
  type: '@auth/sessionUnauthorized'
  payload?: void
  error?: false
}
