import { Merge, Opaque } from 'type-fest'
import { Jsonify } from '../json'
import { MatchmakingType } from '../matchmaking'
import { decodePrettyId, encodePrettyId } from '../pretty-id'
import { RaceStats } from '../races'
import { SbUser, SbUserId } from '../users/sb-user'

export const LEAGUE_IMAGE_WIDTH = 704
export const LEAGUE_IMAGE_HEIGHT = 288

/** The ID of a league as stored in the database. */
export type LeagueId = Opaque<string, 'LeagueId'>
/**
 * The ID of a league as given to clients (equivalent to the DB one, just encoded in a way that
 * looks more friendly in URLs.
 */
export type ClientLeagueId = Opaque<string, 'ClientLeagueId'>

/**
 * Converts a league ID string to a properly typed version. Prefer better ways of getting a typed
 * version, such as retrieving the value from the database or using a Joi validator. This method
 * should mainly be considered for testing and internal behavior.
 */
export function makeLeagueId(id: string): LeagueId {
  return id as LeagueId
}

export function toClientLeagueId(id: LeagueId): ClientLeagueId {
  return encodePrettyId(id) as ClientLeagueId
}

export function fromClientLeagueId(id: ClientLeagueId): LeagueId {
  return decodePrettyId(id) as LeagueId
}

/**
 * Converts a client league ID string to a properly typed version. Prefer better ways of getting a
 * typed version, such as retrieving the value from the database or using a Joi validator. This
 * method should mainly be considered for testing and internal behavior.
 */
export function makeClientLeagueId(id: string): ClientLeagueId {
  return id as ClientLeagueId
}

export interface League {
  id: LeagueId
  name: string
  matchmakingType: MatchmakingType
  description: string
  signupsAfter: Date
  startAt: Date
  endAt: Date
  imagePath?: string
  rulesAndInfo?: string
  link?: string
}

export type LeagueJson = Merge<Jsonify<League>, { id: ClientLeagueId }>

export function toLeagueJson(league: League): LeagueJson {
  return {
    id: toClientLeagueId(league.id),
    name: league.name,
    matchmakingType: league.matchmakingType,
    description: league.description,
    signupsAfter: Number(league.signupsAfter),
    startAt: Number(league.startAt),
    endAt: Number(league.endAt),
    imagePath: league.imagePath,
    rulesAndInfo: league.rulesAndInfo,
    link: league.link,
  }
}

export interface ClientLeagueUser extends RaceStats {
  leagueId: ClientLeagueId
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
