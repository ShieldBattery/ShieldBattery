import { Opaque } from 'type-fest'
import { Jsonify } from '../json'
import { MatchmakingResult, MatchmakingType } from '../matchmaking'
import { RaceStats } from '../races'
import { SbUser, SbUserId } from '../users/sb-user'

export const LEAGUE_IMAGE_WIDTH = 704 * 2
export const LEAGUE_IMAGE_HEIGHT = 288 * 2
export const LEAGUE_BADGE_WIDTH = 80 * 4
export const LEAGUE_BADGE_HEIGHT = 80 * 4

/** The ID of a league as stored in the database. */
export type LeagueId = Opaque<string, 'LeagueId'>

/**
 * Converts a league ID string to a properly typed version. Prefer better ways of getting a typed
 * version, such as retrieving the value from the database or using a Joi validator. This method
 * should mainly be considered for testing and internal behavior.
 */
export function makeLeagueId(id: string): LeagueId {
  return id as LeagueId
}

export interface League {
  id: LeagueId
  name: string
  matchmakingType: MatchmakingType
  description: string
  signupsAfter: Date
  startAt: Date
  endAt: Date
  badgePath?: string
  imagePath?: string
  rulesAndInfo?: string
  link?: string
}

export type LeagueJson = Jsonify<League>

export function toLeagueJson(league: League): LeagueJson {
  return {
    id: league.id,
    name: league.name,
    matchmakingType: league.matchmakingType,
    description: league.description,
    signupsAfter: Number(league.signupsAfter),
    startAt: Number(league.startAt),
    endAt: Number(league.endAt),
    badgePath: league.badgePath,
    imagePath: league.imagePath,
    rulesAndInfo: league.rulesAndInfo,
    link: league.link,
  }
}

export interface ClientLeagueUser extends RaceStats {
  leagueId: LeagueId
  userId: SbUserId
  points: number
  wins: number
  losses: number
  lastPlayedDate?: Date
}

export type ClientLeagueUserJson = Jsonify<ClientLeagueUser>

export function toClientLeagueUserJson(user: ClientLeagueUser): ClientLeagueUserJson {
  return {
    leagueId: user.leagueId,
    userId: user.userId,
    points: user.points,
    wins: user.wins,
    losses: user.losses,
    lastPlayedDate: user.lastPlayedDate ? Number(user.lastPlayedDate) : undefined,
    pWins: user.pWins,
    pLosses: user.pLosses,
    tWins: user.tWins,
    tLosses: user.tLosses,
    zWins: user.zWins,
    zLosses: user.zLosses,
    rWins: user.rWins,
    rLosses: user.rLosses,
    rPWins: user.rPWins,
    rPLosses: user.rPLosses,
    rTWins: user.rTWins,
    rTLosses: user.rTLosses,
    rZWins: user.rZWins,
    rZLosses: user.rZLosses,
  }
}

export interface ClientLeagueUserChange {
  userId: SbUserId
  leagueId: LeagueId
  gameId: string
  changeDate: Date

  outcome: MatchmakingResult
  points: number
  pointsChange: number
}

export type ClientLeagueUserChangeJson = Jsonify<ClientLeagueUserChange>

export function toClientLeagueUserChangeJson(
  change: ClientLeagueUserChange,
): ClientLeagueUserChangeJson {
  return {
    userId: change.userId,
    leagueId: change.leagueId,
    gameId: change.gameId,
    changeDate: Number(change.changeDate),
    outcome: change.outcome,
    points: change.points,
    pointsChange: change.pointsChange,
  }
}

export interface AdminGetLeaguesResponse {
  leagues: LeagueJson[]
}

export interface AdminGetLeagueResponse {
  league: LeagueJson
}

export interface ServerAdminAddLeagueRequest {
  name: string
  matchmakingType: MatchmakingType
  description: string
  signupsAfter: Date
  startAt: Date
  endAt: Date
  rulesAndInfo?: string
  link?: string
}

export type AdminAddLeagueRequest = Jsonify<ServerAdminAddLeagueRequest>

export interface AdminAddLeagueResponse {
  league: LeagueJson
}

export interface ServerAdminEditLeagueRequest {
  name?: string
  matchmakingType?: MatchmakingType
  description?: string
  signupsAfter?: Date
  startAt?: Date
  endAt?: Date
  rulesAndInfo?: string | null
  link?: string | null
  deleteImage?: boolean
  deleteBadge?: boolean
}

export type AdminEditLeagueRequest = Jsonify<ServerAdminEditLeagueRequest>

export interface AdminEditLeagueResponse {
  league: LeagueJson
}

export enum LeagueErrorCode {
  NotFound = 'notFound',
  AlreadyEnded = 'alreadyEnded',
}

export interface GetLeaguesListResponse {
  past: LeagueJson[]
  current: LeagueJson[]
  future: LeagueJson[]

  selfLeagues: ClientLeagueUserJson[]
}

export interface GetLeagueByIdResponse {
  league: LeagueJson
  selfLeagueUser?: ClientLeagueUserJson
}

export interface JoinLeagueResponse {
  league: LeagueJson
  selfLeagueUser: ClientLeagueUserJson
}

export interface GetLeagueLeaderboardResponse {
  league: LeagueJson
  leaderboard: SbUserId[]
  leagueUsers: ClientLeagueUserJson[]
  users: SbUser[]
}
