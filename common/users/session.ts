import { SbPermissions } from './permissions.js'
import { SelfUser } from './sb-user.js'

/**
 * Information about the current user's session, generally used to initialize the application. This
 * data should closely match what we store on the server in the user's session.
 */
export interface ClientSessionInfo {
  user: SelfUser
  permissions: SbPermissions
  jwt: string
}
