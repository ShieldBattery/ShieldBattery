import {
  FriendActivityStatusUpdateEvent,
  GetRelationshipsResponse,
  UserRelationshipJson,
} from '../../common/users/relationships'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import {
  AdminBanUserResponse,
  AdminGetBansResponse,
  AdminGetUserIpsResponse,
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  GetUserRankingHistoryResponse,
  SearchMatchHistoryResponse,
} from '../../common/users/user-network'

export type UserActions =
  | GetUserProfile
  | GetBatchUserInfo
  | LoadUsers
  | SearchMatchHistory
  | AdminGetUserBanHistory
  | AdminBanUser
  | AdminGetUserIps
  | GetRelationships
  | UpsertUserRelationship
  | DeleteUserRelationship
  | UpdateFriendActivityStatus
  | GetUserRankingHistory

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

export interface SearchMatchHistory {
  type: '@users/searchMatchHistory'
  payload: SearchMatchHistoryResponse
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

export interface AdminGetUserIps {
  type: '@users/adminGetUserIps'
  payload: AdminGetUserIpsResponse
}

export interface GetRelationships {
  type: '@users/getRelationships'
  payload: GetRelationshipsResponse
}

export interface UpsertUserRelationship {
  type: '@users/upsertRelationship'
  payload: {
    relationship: UserRelationshipJson
  }
  meta: { selfId: SbUserId }
}

export interface DeleteUserRelationship {
  type: '@users/deleteRelationship'
  payload: {
    targetUser: SbUserId
  }
}

export interface UpdateFriendActivityStatus {
  type: '@users/updateFriendActivityStatus'
  payload: FriendActivityStatusUpdateEvent
}

export type GetUserRankingHistory = {
  type: '@users/getRankingHistory'
  payload: GetUserRankingHistoryResponse
  meta: { userId: SbUserId }
}
