import { GameRecordJson } from '../games/games'
import { TranslationLanguage } from '../i18n'
import { Jsonify } from '../json'
import { LadderPlayer } from '../ladder/ladder'
import { MapInfoJson } from '../maps'
import { MatchmakingSeasonJson, MatchmakingType, SeasonId } from '../matchmaking'
import { SbPolicyType } from '../policies/policy-type'
import { SbPermissions } from '../typeshare'
import { RestrictionKind, RestrictionReason } from './restrictions'
import { SbUser, SelfUser } from './sb-user'
import { SbUserId } from './sb-user-id'
import { UserStats } from './user-stats'

// NOTE(tec27): If you change this, make sure to update the Rust version as well.
/**
 * Characters used in random verification codes sent through email. These were chosen because they
 * are not easily confused for other characters, removing vowels to avoid spelling anything.
 */
export const RANDOM_EMAIL_CODE_CHARACTERS = 'BCDFGHJKLMNPQRTWXY3469'
/**
 * The pattern of codes sent for verification through email (such as for) email verification or
 * password reset.
 */
export const RANDOM_EMAIL_CODE_PATTERN = new RegExp(
  `^[${RANDOM_EMAIL_CODE_CHARACTERS}]{5}-[${RANDOM_EMAIL_CODE_CHARACTERS}]{5}$`,
)

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

export enum UserErrorCode {
  NotFound = 'notFound',
  NotAllowedOnSelf = 'notAllowedOnSelf',
  InvalidCode = 'invalidCode',
  InvalidCredentials = 'invalidCredentials',
  AccountBanned = 'accountBanned',
  SessionExpired = 'sessionExpired',
  UsernameTakenOrRestricted = 'usernameTaken',
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

export const SEARCH_MATCH_HISTORY_LIMIT = 40

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

export interface UserRestrictionHistoryEntry {
  id: string
  userId: SbUserId
  kind: RestrictionKind
  restrictedBy?: SbUserId
  startTime: Date
  endTime: Date
  reason: RestrictionReason
  adminNotes?: string
}

export type UserRestrictionHistoryJson = Jsonify<UserRestrictionHistoryEntry>

export function toUserRestrictionHistoryJson(
  entry: UserRestrictionHistoryEntry,
): UserRestrictionHistoryJson {
  return {
    id: entry.id,
    userId: entry.userId,
    kind: entry.kind,
    restrictedBy: entry.restrictedBy,
    startTime: Number(entry.startTime),
    endTime: Number(entry.endTime),
    reason: entry.reason,
    adminNotes: entry.adminNotes,
  }
}

export interface AdminGetRestrictionsResponse {
  forUser: SbUserId
  restrictions: UserRestrictionHistoryJson[]
  users: SbUser[]
}

export interface AdminApplyRestrictionRequest {
  kind: RestrictionKind
  endTime: number
  reason: RestrictionReason
  adminNotes?: string
}

export interface AdminApplyRestrictionResponse {
  restriction: UserRestrictionHistoryJson
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

export interface EmailChangedEvent {
  action: 'emailChanged'
  userId: SbUserId
  email: string
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

export type AuthEvent = EmailChangedEvent | EmailVerifiedEvent | PermissionsChangedEvent

export interface UsernameAvailableResponse {
  available: boolean
}

export interface RecoverUsernameRequest {
  email: string
}

export interface RequestPasswordResetRequest {
  username: string
  email: string
}

export interface ResetPasswordRequest {
  code: string
  password: string
}
