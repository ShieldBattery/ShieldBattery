import {
  AdminBanUserResponse,
  AdminGetBansResponse,
  AdminGetUserIpsResponse,
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  SbUserId,
} from '../../common/users/sb-user'

export type ProfileActions =
  | GetUserProfile
  | GetBatchUserInfo
  | AdminGetUserBanHistory
  | AdminBanUser
  | AdminGetUserIps

export interface GetUserProfile {
  type: '@profile/getUserProfile'
  payload: GetUserProfileResponse
}

export type GetBatchUserInfo =
  | {
      type: '@profile/getBatchUserInfo'
      payload: GetBatchUserInfoResponse
      error?: false
      meta: {
        userIds: ReadonlyArray<SbUserId>
      }
    }
  | {
      type: '@profile/getBatchUserInfo'
      payload: Error
      error: true
      meta: {
        userIds: ReadonlyArray<SbUserId>
      }
    }

export interface AdminGetUserBanHistory {
  type: '@profile/adminGetUserBanHistory'
  payload: AdminGetBansResponse
}

export interface AdminBanUser {
  type: '@profile/adminBanUser'
  payload: AdminBanUserResponse
}

export interface AdminGetUserIps {
  type: '@profile/adminGetUserIps'
  payload: AdminGetUserIpsResponse
}
