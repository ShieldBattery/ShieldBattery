import { Opaque } from 'type-fest'
import { GameRecordJson } from '../games/games'
import { LadderPlayer } from '../ladder'
import { MapInfoJson } from '../maps'
import { MatchmakingType } from '../matchmaking'
import { UserStats } from './user-stats'

export type SbUserId = Opaque<number, 'SbUser'>

/**
 * Information about any user in the system, mainly things that represent the "identity" of the
 * user.
 */
export interface SbUser {
  id: SbUserId
  name: string
}

/**
 * Converts a user ID number into a properly typed version. Alternative methods of retrieving an
 * SbUserId should be preferred, such as using a value retrieved from the database, or getting one
 * via the common Joi validator.
 */
export function makeSbUserId(id: number): SbUserId {
  return id as SbUserId
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
  userId: SbUserId
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
