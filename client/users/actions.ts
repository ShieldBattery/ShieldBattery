import { AvailabilityUpdateEvent } from '../../common/users/availability'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import {
  AdminBanUserResponse,
  AdminGetBansResponse,
  AdminGetUserIpsResponse,
  AdminUnbanUserResponse,
  GetBatchUserInfoResponse,
  GetMatchHistoryResponse,
  GetUserProfileResponse,
  GetUserRankingHistoryResponse,
} from '../../common/users/user-network'

export type UserActions =
  | GetUserProfile
  | GetBatchUserInfo
  | LoadUsers
  | GetMatchHistory
  | AdminGetUserBanHistory
  | AdminBanUser
  | AdminUnbanUser
  | AdminGetUserIps
  | AdminAvatarCleared
  | GetUserRankingHistory
  | UpdateFriendAvailability

/** A friend's availability changed, or they came online or went offline. */
export interface UpdateFriendAvailability {
  type: '@users/updateFriendAvailability'
  payload: AvailabilityUpdateEvent
}

export interface GetUserProfile {
  type: '@users/getUserProfile'
  payload: GetUserProfileResponse
}

export type GetBatchUserInfo =
  | {
      type: '@users/getBatchUserInfo'
      payload: GetBatchUserInfoResponse
      error?: false
      meta: {
        userIds: ReadonlyArray<SbUserId>
      }
    }
  | {
      type: '@users/getBatchUserInfo'
      payload: Error
      error: true
      meta: {
        userIds: ReadonlyArray<SbUserId>
      }
    }

export interface LoadUsers {
  type: '@users/loadUsers'
  payload: SbUser[]
}

export interface GetMatchHistory {
  type: '@users/getMatchHistory'
  payload: GetMatchHistoryResponse
  meta: { userId: SbUserId }
}

export interface AdminGetUserBanHistory {
  type: '@users/adminGetUserBanHistory'
  payload: AdminGetBansResponse
}

export interface AdminBanUser {
  type: '@users/adminBanUser'
  payload: AdminBanUserResponse
}

export interface AdminUnbanUser {
  type: '@users/adminUnbanUser'
  payload: AdminUnbanUserResponse
}

export interface AdminGetUserIps {
  type: '@users/adminGetUserIps'
  payload: AdminGetUserIpsResponse
}

/** An admin removed a user's avatar. */
export interface AdminAvatarCleared {
  type: '@users/avatarCleared'
  payload: { userId: SbUserId }
}

export type GetUserRankingHistory = {
  type: '@users/getRankingHistory'
  payload: GetUserRankingHistoryResponse
  meta: { userId: SbUserId }
}
