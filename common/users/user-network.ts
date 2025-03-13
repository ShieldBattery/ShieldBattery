import { GameRecordJson } from '../games/games'
import { TranslationLanguage } from '../i18n'
import { Jsonify } from '../json'
import { LadderPlayer } from '../ladder/ladder'
import { MapInfoJson } from '../maps'
import { MatchmakingSeasonJson, MatchmakingType, SeasonId } from '../matchmaking'
import { SbPolicyType } from '../policies/policy-type'
import { SbPermissions } from '../typeshare'
import { SbUser, SelfUser } from './sb-user'
import { SbUserId } from './sb-user-id'
import { UserStats } from './user-stats'

/**
 * Detailed information about a user, such as their ladder ranking, win record, etc.
 */
export interface UserProfile {
  userId: SbUserId
  created: Date
  ladder: Partial<Record<MatchmakingType, LadderPlayer>>
  seasonId: SeasonId
  userStats: UserStats
}

export type UserProfileJson = Jsonify<UserProfile>

export function toUserProfileJson(userProfile: UserProfile): UserProfileJson {
  return {
    userId: userProfile.userId,
    created: Number(userProfile.created),
    ladder: userProfile.ladder,
    seasonId: userProfile.seasonId,
    userStats: userProfile.userStats,
  }
}

// TODO(tec27): Finish adding codes from remaining user APIs
export enum UserErrorCode {
  NotFound = 'notFound',
  NotAllowedOnSelf = 'notAllowedOnSelf',
  InvalidCode = 'invalidCode',
  InvalidCredentials = 'invalidCredentials',
  AccountBanned = 'accountBanned',
  SessionExpired = 'sessionExpired',
  UsernameTaken = 'usernameTaken',
  SuspiciousActivity = 'suspiciousActivity',
  MachineBanned = 'machineBanned',
}

/** Information returned for /users/:id/profile, intended to be able to fill out a profile page. */
export interface GetUserProfileResponse {
  user: SbUser
  profile: UserProfileJson
  matchHistory: {
    games: GameRecordJson[]
    maps: MapInfoJson[]
    users: SbUser[]
  }
  seasons: MatchmakingSeasonJson[]
}

/**
 * The response returned when searching the user's match history.
 */
export interface SearchMatchHistoryResponse {
  games: GameRecordJson[]
  maps: MapInfoJson[]
  users: SbUser[]
  hasMoreGames: boolean
}

export interface GetUserRankingHistoryResponse {
  history: LadderPlayer[]
  seasons: MatchmakingSeasonJson[]
}

export interface GetBatchUserInfoResponse {
  userInfos: SbUser[]
}

export interface AcceptPoliciesRequest {
  policies: Array<[policyType: SbPolicyType, version: number]>
}

export interface AcceptPoliciesResponse {
  user: SelfUser
}

export interface ChangeLanguageRequest {
  language: TranslationLanguage
}

export interface ChangeLanguagesResponse {
  user: SelfUser
}

export interface AdminGetPermissionsResponse {
  user: SbUser
  permissions: SbPermissions
}

export interface AdminUpdatePermissionsRequest {
  permissions: SbPermissions
}

export interface BanHistoryEntry {
  id: string
  userId: SbUserId
  bannedBy?: SbUserId
  startTime: Date
  endTime: Date
  reason?: string
}

export type BanHistoryEntryJson = Jsonify<BanHistoryEntry>

export function toBanHistoryEntryJson(entry: BanHistoryEntry) {
  return {
    id: entry.id,
    userId: entry.userId,
    bannedBy: entry.bannedBy,
    startTime: Number(entry.startTime),
    endTime: Number(entry.endTime),
    reason: entry.reason,
  }
}

export interface AdminGetBansResponse {
  forUser: SbUserId
  bans: BanHistoryEntryJson[]
  users: SbUser[]
}

export interface AdminBanUserRequest {
  banLengthHours: number
  reason?: string
}

export interface AdminBanUserResponse {
  ban: BanHistoryEntryJson
  users: SbUser[]
}

export interface UserIpInfo {
  userId: SbUserId
  ipAddress: string
  firstUsed: Date
  lastUsed: Date
  timesSeen: number
}

export type UserIpInfoJson = Jsonify<UserIpInfo>

export function toUserIpInfoJson(info: UserIpInfo): UserIpInfoJson {
  return {
    userId: info.userId,
    ipAddress: info.ipAddress,
    firstUsed: Number(info.firstUsed),
    lastUsed: Number(info.lastUsed),
    timesSeen: info.timesSeen,
  }
}

export interface AdminGetUserIpsResponse {
  forUser: SbUserId
  ips: UserIpInfoJson[]
  relatedUsers: Array<[ip: string, infos: Array<UserIpInfoJson>]>
  users: SbUser[]
}

export interface EmailVerifiedEvent {
  action: 'emailVerified'
  userId: SbUserId
}

export interface PermissionsChangedEvent {
  action: 'permissionsChanged'
  userId: SbUserId
  permissions: SbPermissions
}

export type AuthEvent = EmailVerifiedEvent | PermissionsChangedEvent
