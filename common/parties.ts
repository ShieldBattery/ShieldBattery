import { Immutable } from 'immer'
import { MatchmakingPreferences, MatchmakingType } from './matchmaking'
import { RaceChar } from './races'
import { SbUser, SbUserId } from './users/sb-user'

/**
 * The maximum number of players allowed to be in the same party at once. Note that this only
 * restricts the amount of players *in* the party, it doesn't limit the number of invites to the
 * party.
 */
export const MAX_PARTY_SIZE = 8

export enum PartyServiceErrorCode {
  AlreadyMember = 'AlreadyMember',
  AlreadyInGameplayActivity = 'AlreadyInGameplayActivity',
  Blocked = 'Blocked',
  InsufficientPermissions = 'InsufficientPermissions',
  InvalidAction = 'InvalidAction',
  InvalidSelfAction = 'InvalidSelfAction',
  NotFoundOrNotInvited = 'NotFoundOrNotInvited',
  NotFoundOrNotInParty = 'NotFoundOrNotInParty',
  NotificationFailure = 'NotificationFailure',
  PartyFull = 'PartyFull',
  UserNotFound = 'UserNotFound',
  UserOffline = 'UserOffline',
}

export interface PartyChatMessage {
  partyId: string
  time: number
  text: string
  user: SbUser
}

export interface PartyJson {
  id: string
  invites: SbUserId[]
  members: SbUserId[]
  leader: SbUserId
}

export interface PartyInitEvent {
  type: 'init'
  party: PartyJson
  time: number
  userInfos: SbUser[]
}

export interface PartyInviteEvent {
  type: 'invite'
  invitedUser: SbUserId
  time: number
  userInfo: SbUser
}

export interface PartyUninviteEvent {
  type: 'uninvite'
  target: SbUserId
  time: number
}

export interface PartyJoinEvent {
  type: 'join'
  user: SbUserId
  userInfo: SbUser
  time: number
}

export interface PartyLeaveEvent {
  type: 'leave'
  user: SbUserId
  time: number
}

export interface PartyLeaderChangeEvent {
  type: 'leaderChange'
  leader: SbUserId
  time: number
}

export interface PartyChatMessageEvent {
  type: 'chatMessage'
  message: PartyChatMessage
  mentions: SbUser[]
}

export interface PartyKickEvent {
  type: 'kick'
  target: SbUserId
  time: number
}

export interface PartyQueueEvent {
  type: 'queue'
  id: string
  matchmakingType: MatchmakingType
  accepted: Array<[userId: SbUserId, race: RaceChar]>
  unaccepted: SbUserId[]
  time: number
}

export interface PartyQueueCancelEvent {
  type: 'queueCancel'
  id: string
  reason: PartyQueueCancelReason
  time: number
}

export interface PartyQueueReadyEvent {
  type: 'queueReady'
  id: string
  queuedMembers: Array<[userId: SbUserId, race: RaceChar]>
  time: number
}

export type PartyEvent =
  | PartyInitEvent
  | PartyInviteEvent
  | PartyUninviteEvent
  | PartyJoinEvent
  | PartyLeaveEvent
  | PartyLeaderChangeEvent
  | PartyChatMessageEvent
  | PartyKickEvent
  | PartyQueueEvent
  | PartyQueueCancelEvent
  | PartyQueueReadyEvent

export interface InviteIdToPartyRequest {
  clientId: string
  targetId: number
}

export interface InviteNameToPartyRequest {
  clientId: string
  targetName: string
}

export type InviteToPartyRequest = InviteIdToPartyRequest | InviteNameToPartyRequest

export interface AcceptPartyInviteRequest {
  clientId: string
}

export interface SendPartyChatMessageRequest {
  message: string
}

export interface ChangePartyLeaderRequest {
  targetId: number
}

export interface FindMatchAsPartyRequest {
  preferences: Immutable<MatchmakingPreferences>
  identifiers: [type: number, hashStr: string][]
}

export interface AcceptFindMatchAsPartyRequest {
  race: RaceChar
  identifiers: [type: number, hashStr: string][]
}

export type PartyQueueCancelReason =
  | PartyQueueRejected
  | PartyQueueUserLeft
  | PartyQueueMatchmakingDisabled
  | PartyQueueError

export interface PartyQueueRejected {
  type: 'rejected'
  user: SbUserId
}

export interface PartyQueueUserLeft {
  type: 'userLeft'
  user: SbUserId
}

export interface PartyQueueMatchmakingDisabled {
  type: 'matchmakingDisabled'
}

export interface PartyQueueError {
  type: 'error'
  // TODO(tec27): should we pass more details? I think this will often just be some server error...
}
