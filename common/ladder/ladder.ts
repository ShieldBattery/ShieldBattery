import {
  MatchmakingDivision,
  MatchmakingSeasonJson,
  MatchmakingType,
  pointsToMatchmakingDivision,
  SeasonId,
} from '../matchmaking'
import { RaceStats } from '../races'
import { SbUser } from '../users/sb-user'
import { SbUserId } from '../users/sb-user-id'

/**
 * A ranked player for a particular matchmaking ladder in a particular season. Contains information
 * about their play history and current rating.
 */
export interface LadderPlayer extends RaceStats {
  rank: number
  userId: SbUserId
  matchmakingType: MatchmakingType
  seasonId: SeasonId
  rating: number
  points: number
  bonusUsed: number
  lifetimeGames: number
  wins: number
  losses: number
  lastPlayedDate: number
}

export function ladderPlayerToMatchmakingDivision(
  player: Readonly<LadderPlayer>,
  bonusPool: number,
): MatchmakingDivision {
  if (!player.points && player.wins + player.losses === 0) {
    return MatchmakingDivision.Unrated
  } else {
    return pointsToMatchmakingDivision(player.points, bonusPool)
  }
}

export enum LadderErrorCode {
  NotFound = 'NotFound',
  OnlyAllowedOnSelf = 'OnlyAllowedOnSelf',
}

// TODO(#658): Implement pagination for this request
/**
 * Payload returned for a request to retrieve the current rankings for a MatchmakingType.
 */
export interface GetRankingsResponse {
  /** The total number of ranked players for this MatchmakingType. */
  totalCount: number
  /** A list of the players that are currently ranked (in order of rank). */
  players: LadderPlayer[]
  /** A list of user info for players that are in the returned `players` list. */
  users: SbUser[]
  /** A unix timestamp of the last time the rankings were refreshed. */
  lastUpdated: number
  /** The season these rankings are for. */
  season: MatchmakingSeasonJson
}

/**
 * The ranks/rating/etc. for a given user, across all matchmaking types. Note that the info other
 * than the rank here is "instantaneous", that is, it is calculated on the fly and not batched. The
 * rank is only updated every so often.
 */
export interface GetRankForUserResponse {
  ranks: Partial<Record<MatchmakingType, LadderPlayer>>
  user: SbUser
  currentSeason: MatchmakingSeasonJson
}
