import {
  GetBatchUserInfoResponse,
  GetUserProfileResponse,
  SbUserId,
} from '../../common/users/user-info'

export type ProfileActions = GetUserProfile | GetBatchUserInfo

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
