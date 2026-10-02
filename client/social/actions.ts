import {
  FriendActivityStatusUpdateEvent,
  GetRelationshipsResponse,
  UserRelationshipJson,
} from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'

export type SocialActions =
  | GetRelationships
  | GetRelationshipsFailure
  | UpsertUserRelationship
  | DeleteUserRelationship
  | UpdateFriendActivityStatus

export interface GetRelationships {
  type: '@users/getRelationships'
  payload: GetRelationshipsResponse
}

/** A request for the current user's relationships failed for a reason other than being aborted. */
export interface GetRelationshipsFailure {
  type: '@users/getRelationshipsFailure'
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
