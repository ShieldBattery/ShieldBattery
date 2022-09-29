import { Jsonify } from '../json'
import { SbUser, SbUserId } from './sb-user'

/**
 * The maximum amount of friends you can have (including outgoing requests).
 */
export const MAX_FRIENDS = 40
/**
 * The maximum amount of users you can have blocked.
 */
export const MAX_BLOCKS = 150

export enum UserRelationshipKind {
  Friend = 'friend',
  FriendRequest = 'friend_request',
  Block = 'block',
}

export interface UserRelationship {
  fromId: SbUserId
  toId: SbUserId
  kind: UserRelationshipKind
  createdAt: Date
}

export type UserRelationshipJson = Jsonify<UserRelationship>

export function toUserRelationshipJson(relationship: UserRelationship): UserRelationshipJson {
  return {
    fromId: relationship.fromId,
    toId: relationship.toId,
    kind: relationship.kind,
    createdAt: Number(relationship.createdAt),
  }
}

export interface UserRelationshipSummary {
  friends: UserRelationship[]
  incomingRequests: UserRelationship[]
  outgoingRequests: UserRelationship[]
  blocks: UserRelationship[]
}

export type UserRelationshipSummaryJson = Jsonify<UserRelationshipSummary>

export function toUserRelationshipSummaryJson(
  summary: UserRelationshipSummary,
): UserRelationshipSummaryJson {
  return {
    friends: summary.friends.map(toUserRelationshipJson),
    incomingRequests: summary.incomingRequests.map(toUserRelationshipJson),
    outgoingRequests: summary.outgoingRequests.map(toUserRelationshipJson),
    blocks: summary.blocks.map(toUserRelationshipJson),
  }
}

export enum UserRelationshipServiceErrorCode {
  /** The user you're attempting to send a request to has blocked you. */
  BlockedByUser = 'blockedByUser',
  /** Cannot perform this action against yourself. */
  InvalidSelfAction = 'invalidSelfAction',
  /** You've exceeded the amount of friends/blocks allowed for your account. */
  LimitReached = 'limitReached',
  /** Couldn't find an entry (request, friendship, block) matching the criteria. */
  NoMatchingEntry = 'noMatchingEntry',
}

export interface GetRelationshipsResponse {
  summary: UserRelationshipSummaryJson
  users: SbUser[]
}

export interface ModifyRelationshipResponse {
  relationship: UserRelationshipJson
  user: SbUser
}

export type UserRelationshipEvent = UserRelationshipUpsertEvent | UserRelationshipDeleteEvent

export interface UserRelationshipUpsertEvent {
  type: 'upsert'
  relationship: UserRelationshipJson
}

export interface UserRelationshipDeleteEvent {
  type: 'delete'
  targetUser: SbUserId
}

// TODO(tec27): Add more stuff to this, like ingame, idle, etc.
export enum FriendActivityStatus {
  Online = 'online',
  Offline = 'offline',
}

export interface FriendActivityStatusUpdateEvent {
  userId: SbUserId
  status: FriendActivityStatus
}
