import { SbPermissions } from './permissions'
import { SelfUserJson } from './sb-user'

/**
 * Information about the current user's session, generally used to initialize the application. This
 * data should closely match what we store on the server in the user's session.
 */
export interface ClientSessionInfo {
  user: SelfUserJson
  permissions: SbPermissions
  jwt: string
}

/** The kind of client a session was created by. */
export type SessionClientClass = 'app' | 'development' | 'web'
