import {
  FriendActivityStatusUpdateEvent,
  GetRelationshipsResponse,
  UserRelationshipJson,
} from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'

export type SocialActions =
  | GetRelationships
  | UpsertUserRelationship
  | DeleteUserRelationship
  | UpdateFriendActivityStatus

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
