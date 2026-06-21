import {
  isSoloType,
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
    return pointsToMatchmakingDivision(isSoloType(player.matchmakingType), player.points, bonusPool)
  }
}

/** How many rank cards a user's profile shows before offering to expand to all of their modes. */
export const DEFAULT_PROFILE_RANKS_SHOWN = 2

/**
 * Returns the matchmaking types a user has played at least one game in, sorted by how active they've
 * been (most games played first). Used to show a user's ranks on their profile with the most relevant
 * modes first; the profile shows only the first few by default and lets the user expand to the rest.
 */
export function getRankedTypesByActivity(
  ladder: Partial<Record<MatchmakingType, LadderPlayer>>,
): MatchmakingType[] {
  return (Object.keys(ladder) as MatchmakingType[])
    .filter(type => {
      const player = ladder[type]
      return player ? player.wins + player.losses > 0 : false
    })
    .sort((a, b) => ladder[b]!.wins + ladder[b]!.losses - (ladder[a]!.wins + ladder[a]!.losses))
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
