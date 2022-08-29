import { GetRelationshipsResponse, UserRelationshipJson } from '../../common/users/relationships'
import {
  AdminBanUserResponse,
  AdminGetBansResponse,
  AdminGetUserIpsResponse,
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  SbUserId,
} from '../../common/users/sb-user'

export type UserActions =
  | GetUserProfile
  | GetBatchUserInfo
  | AdminGetUserBanHistory
  | AdminBanUser
  | AdminGetUserIps
  | GetRelationships
  | UpsertUserRelationship
  | DeleteUserRelationship

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
