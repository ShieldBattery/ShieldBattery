import { MatchmakingType } from '../matchmaking'
import { SbPermissions } from './permissions'
import { SelfUser } from './user-info'

/**
 * Information about the current user's session, generally used to initialize the application. This
 * data should closely match what we store on the server in the user's session.
 */
export interface ClientSessionInfo {
  user: SelfUser
  permissions: SbPermissions
  lastQueuedMatchmakingType: MatchmakingType
}
