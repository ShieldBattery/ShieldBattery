/**
 * A ranked player for a particular matchmaking ladder. Contains information about their play
 * history and current rating.
 */
export interface LadderPlayer {
  rank: number
  user: {
    id: number
    name: string
  }
  rating: number
  wins: number
  losses: number
  lastPlayedDate: number
}

// TODO(#658): Implement pagination for this request
/**
 * Payload returned for a request to retrieve the current rankings for a MatchmakingType.
 */
export interface GetRankingsPayload {
  /** The total number of ranked players for this MatchmakingType. */
  totalCount: number
  /** A list of the players that are currently ranked (in order of rank). */
  players: LadderPlayer[]
}
