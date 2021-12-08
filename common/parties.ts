import { SbUser, SbUserId } from './users/user-info'

/**
 * The maximum number of players allowed to be in the same party at once. Note that this only
 * restricts the amount of players *in* the party, it doesn't limit the number of invites to the
 * party.
 */
export const MAX_PARTY_SIZE = 8

export enum PartyServiceErrorCode {
  NotFoundOrNotInvited = 'NotFoundOrNotInvited',
  NotFoundOrNotInParty = 'NotFoundOrNotInParty',
  InsufficientPermissions = 'InsufficientPermissions',
  PartyFull = 'PartyFull',
  UserOffline = 'UserOffline',
  InvalidAction = 'InvalidAction',
  NotificationFailure = 'NotificationFailure',
  AlreadyMember = 'AlreadyMember',
  InvalidSelfAction = 'InvalidSelfAction',
}

export interface PartyChatMessage {
  partyId: string
  time: number
  text: string
  user: SbUser
}

export interface AddInvitePayload {
  partyId: string
  from: SbUserId
}

export interface RemoveInvitePayload {
  partyId: string
}

export interface PartyPayload {
  id: string
  invites: SbUserId[]
  members: SbUserId[]
  leader: SbUserId
}

export interface PartyInitEvent {
  type: 'init'
  party: PartyPayload
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

export type PartyEvent =
  | PartyInitEvent
  | PartyInviteEvent
  | PartyUninviteEvent
  | PartyJoinEvent
  | PartyLeaveEvent
  | PartyLeaderChangeEvent
  | PartyChatMessageEvent
  | PartyKickEvent

export interface InviteToPartyServerBody {
  clientId: string
  targetId: number
}

export interface AcceptPartyInviteServerBody {
  clientId: string
}

export interface SendChatMessageServerBody {
  message: string
}

export interface ChangeLeaderServerBody {
  targetId: number
}
