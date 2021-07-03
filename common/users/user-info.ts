import { LadderPlayer } from '../ladder'
import { MatchmakingType } from '../matchmaking'
import { Permissions } from './permissions'

/** Information about the current user and their capabilities that is transmitted to the client. */
export interface SelfUserInfo {
  user: SelfUser
  permissions: Permissions
}

/** Information about the current user. */
export interface SelfUser {
  id: number
  name: string
  email: string
  emailVerified: boolean
}

/** Information about any user in the system, mainly things that represent the "identity" of the
 * user. */
export interface User {
  id: number
  name: string
}

/**
 * Detailed information about a user, such as their ladder ranking, win record, etc.
 */
export interface UserProfile {
  userId: number
  ladder: Partial<Record<MatchmakingType, LadderPlayer>>
  // TODO(tec27): Add more stuff
}

/** Information returned for /users/:id/profile, intended to be able to fill out a profile page. */
export interface GetUserProfilePayload {
  user: User
  profile: UserProfile
}
