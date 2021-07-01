import { GetUserProfilePayload } from '../../common/users/user-info'

export type ProfileActions = GetUserProfile

export interface GetUserProfile {
  type: '@profile/getUserProfile'
  payload: GetUserProfilePayload
}
