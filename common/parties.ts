import { User } from './users/user-info'

/**
 * The maximum number of players allowed to be in the same party at once. Note that this only
 * restricts the amount of players *in* the party, it doesn't limit the number of invites to the
 * party.
 */
export const MAX_PARTY_SIZE = 8

export interface PartyUser {
  id: number
  name: string
}

export interface ChatMessage {
  from: PartyUser
  time: number
  text: string
}

export interface AddInvitePayload {
  partyId: string
  from: PartyUser
}

export interface RemoveInvitePayload {
  partyId: string
}

export interface PartyPayload {
  id: string
  invites: Array<PartyUser>
  members: Array<PartyUser>
  leader: PartyUser
}

export interface PartyInitEvent {
  type: 'init'
  party: PartyPayload
  userInfos: User[]
}

export interface PartyInviteEvent {
  type: 'invite'
  invitedUser: PartyUser
  userInfo: User
}

export interface PartyUninviteEvent {
  type: 'uninvite'
  target: PartyUser
}

export interface PartyDeclineEvent {
  type: 'decline'
  target: PartyUser
}

export interface PartyJoinEvent {
  type: 'join'
  user: PartyUser
}

export interface PartyLeaveEvent {
  type: 'leave'
  user: PartyUser
}

export interface PartyChatMessageEvent extends ChatMessage {
  type: 'chatMessage'
}

export type PartyEvent =
  | PartyInitEvent
  | PartyInviteEvent
  | PartyUninviteEvent
  | PartyDeclineEvent
  | PartyJoinEvent
  | PartyLeaveEvent
  | PartyChatMessageEvent

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
