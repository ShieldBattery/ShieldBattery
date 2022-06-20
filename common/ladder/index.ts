import {
  MatchmakingDivision,
  NUM_PLACEMENT_MATCHES,
  ratingToMatchmakingDivision,
} from '../matchmaking'
import { RaceStats } from '../races'
import { SbUser, SbUserId } from '../users/sb-user'

/**
 * A ranked player for a particular matchmaking ladder. Contains information about their play
 * history and current rating.
 */
export interface LadderPlayer extends RaceStats {
  rank: number
  userId: SbUserId
  rating: number
  points: number
  bonusUsed: number
  lifetimeGames: number
  wins: number
  losses: number
  lastPlayedDate: number
}

export function ladderPlayerToMatchmakingDivision(player: LadderPlayer): MatchmakingDivision {
  if (player.lifetimeGames < NUM_PLACEMENT_MATCHES) {
    return MatchmakingDivision.Unranked
  } else {
    return ratingToMatchmakingDivision(player.rating, player.rank)
  }
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
}
