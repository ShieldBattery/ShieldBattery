import {
  AdminBanUserResponse,
  AdminGetBansResponse,
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  SbUserId,
} from '../../common/users/user-info'

export type ProfileActions =
  | GetUserProfile
  | GetBatchUserInfo
  | AdminGetUserBanHistory
  | AdminBanUser

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
