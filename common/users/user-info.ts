import { GameRecordJson } from '../games/games'
import { LadderPlayer } from '../ladder'
import { MapInfoJson } from '../maps'
import { MatchmakingType } from '../matchmaking'
import { UserStats } from './user-stats'

/**
 * Information about any user in the system, mainly things that represent the "identity" of the
 * user.
 */
export interface SbUser {
  id: number
  name: string
}

/** Information about the current user. */
export interface SelfUser extends SbUser {
  email: string
  emailVerified: boolean
}

/**
 * Detailed information about a user, such as their ladder ranking, win record, etc.
 */
export interface UserProfile {
  userId: number
  ladder: Partial<Record<MatchmakingType, LadderPlayer>>
  userStats: UserStats
}

/** Information returned for /users/:id/profile, intended to be able to fill out a profile page. */
export interface GetUserProfilePayload {
  user: SbUser
  profile: UserProfile
  matchHistory: {
    games: GameRecordJson[]
    maps: MapInfoJson[]
    users: SbUser[]
  }
}
