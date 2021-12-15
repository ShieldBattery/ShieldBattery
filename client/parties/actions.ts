import { Immutable } from 'immer'
import { MatchmakingPreferences, MatchmakingType } from '../../common/matchmaking'
import { PartyChatMessage, PartyJson, PartyQueueCancelReason } from '../../common/parties'
import { RaceChar } from '../../common/races'
import { SbUser, SbUserId } from '../../common/users/user-info'
import { BaseFetchFailure } from '../network/fetch-errors'

export type PartyActions =
  | InviteToPartyBegin
  | InviteToPartySuccess
  | InviteToPartyFailure
  | RemovePartyInviteBegin
  | RemovePartyInviteSuccess
  | RemovePartyInviteFailure
  | DeclinePartyInviteBegin
  | DeclinePartyInviteSuccess
  | DeclinePartyInviteFailure
  | AcceptPartyInviteBegin
  | AcceptPartyInviteSuccess
  | AcceptPartyInviteFailure
  | LeavePartyBegin
  | LeavePartySuccess
  | LeavePartyFailure
  | SendChatMessageBegin
  | SendChatMessageSuccess
  | SendChatMessageFailure
  | KickFromPartyBegin
  | KickFromPartySuccess
  | KickFromPartyFailure
  | ChangePartyLeaderBegin
  | ChangePartyLeaderSuccess
  | ChangePartyLeaderFailure
  | FindMatchAsParty
  | ActivateParty
  | DeactivateParty
  | InitParty
  | UpdateInvite
  | UpdateUninvite
  | UpdateJoin
  | UpdateLeave
  | UpdateLeaveSelf
  | UpdateLeaderChange
  | UpdateChatMessage
  | UpdateKick
  | UpdateKickSelf
  | UpdateQueue
  | UpdateQueueCancel
  | UpdateQueueReady

export interface InviteToPartyBegin {
  type: '@parties/inviteToPartyBegin'
  payload: {
    clientId: string
    targetId: SbUserId
  }
}

export interface InviteToPartySuccess {
  type: '@parties/inviteToParty'
  payload: void
  meta: {
    clientId: string
    targetId: SbUserId
  }
  error?: false
}

export interface InviteToPartyFailure extends BaseFetchFailure<'@parties/inviteToParty'> {
  meta: {
    clientId: string
    targetId: SbUserId
  }
}

export interface RemovePartyInviteBegin {
  type: '@parties/removePartyInviteBegin'
  payload: {
    partyId: string
    targetId: SbUserId
  }
}

export interface RemovePartyInviteSuccess {
  type: '@parties/removePartyInvite'
  payload: void
  meta: {
    partyId: string
    targetId: SbUserId
  }
  error?: false
}

export interface RemovePartyInviteFailure extends BaseFetchFailure<'@parties/removePartyInvite'> {
  meta: {
    partyId: string
    targetId: SbUserId
  }
}

export interface DeclinePartyInviteBegin {
  type: '@parties/declinePartyInviteBegin'
  payload: {
    partyId: string
  }
}

export interface DeclinePartyInviteSuccess {
  type: '@parties/declinePartyInvite'
  payload: void
  meta: {
    partyId: string
  }
  error?: false
}

export interface DeclinePartyInviteFailure extends BaseFetchFailure<'@parties/declinePartyInvite'> {
  meta: {
    partyId: string
  }
}

export interface AcceptPartyInviteBegin {
  type: '@parties/acceptPartyInviteBegin'
  payload: {
    partyId: string
    clientId: string
  }
}

export interface AcceptPartyInviteSuccess {
  type: '@parties/acceptPartyInvite'
  payload: void
  meta: {
    partyId: string
    clientId: string
  }
  error?: false
}

export interface AcceptPartyInviteFailure extends BaseFetchFailure<'@parties/acceptPartyInvite'> {
  meta: {
    partyId: string
    clientId: string
  }
}

export interface LeavePartyBegin {
  type: '@parties/leavePartyBegin'
  payload: {
    partyId: string
    clientId: string
  }
}

export interface LeavePartySuccess {
  type: '@parties/leaveParty'
  payload: void
  meta: {
    partyId: string
    clientId: string
  }
  error?: false
}

export interface LeavePartyFailure extends BaseFetchFailure<'@parties/leaveParty'> {
  meta: {
    partyId: string
    clientId: string
  }
}

export interface SendChatMessageBegin {
  type: '@parties/sendChatMessageBegin'
  payload: {
    partyId: string
    message: string
  }
}

/**
 * Send a chat message to the party.
 */
export interface SendChatMessageSuccess {
  type: '@parties/sendChatMessage'
  payload: void
  meta: {
    partyId: string
    message: string
  }
  error?: false
}

export interface SendChatMessageFailure extends BaseFetchFailure<'@parties/sendChatMessage'> {
  meta: {
    partyId: string
    message: string
  }
}

export interface KickFromPartyBegin {
  type: '@parties/kickFromPartyBegin'
  payload: {
    partyId: string
    targetId: SbUserId
  }
}

export interface KickFromPartySuccess {
  type: '@parties/kickFromParty'
  payload: void
  meta: {
    partyId: string
    targetId: SbUserId
  }
  error?: false
}

export interface KickFromPartyFailure extends BaseFetchFailure<'@parties/kickFromParty'> {
  meta: {
    partyId: string
    targetId: SbUserId
  }
}

export interface ChangePartyLeaderBegin {
  type: '@parties/changePartyLeaderBegin'
  payload: {
    partyId: string
    targetId: SbUserId
  }
}

export interface ChangePartyLeaderSuccess {
  type: '@parties/changePartyLeader'
  payload: void
  meta: {
    partyId: string
    targetId: SbUserId
  }
  error?: false
}

export interface ChangePartyLeaderFailure extends BaseFetchFailure<'@parties/changePartyLeader'> {
  meta: {
    partyId: string
    targetId: SbUserId
  }
}

export interface FindMatchAsParty {
  type: '@parties/findMatchAsParty'
  payload: void
  meta: {
    partyId: string
    preferences: Immutable<MatchmakingPreferences>
  }
  error?: false
}

/**
 * Activate the party the user is in. This is a purely client-side action which marks the party as
 * "active", and removes the unread indicator if there is one.
 */
export interface ActivateParty {
  type: '@parties/activateParty'
  payload: {
    partyId: string
  }
}

/**
 * Deactivate the party the user is in. This is a purely client-side action which unloads the
 * message history of a party chat and thus frees up some memory.
 */
export interface DeactivateParty {
  type: '@parties/deactivateParty'
  payload: {
    partyId: string
  }
}

export interface InitParty {
  type: '@parties/init'
  payload: {
    party: PartyJson
    time: number
    userInfos: SbUser[]
  }
}

export interface UpdateInvite {
  type: '@parties/updateInvite'
  payload: {
    partyId: string
    invitedUser: SbUserId
    time: number
    userInfo: SbUser
  }
}

export interface UpdateUninvite {
  type: '@parties/updateUninvite'
  payload: {
    partyId: string
    target: SbUserId
    time: number
  }
}

export interface UpdateJoin {
  type: '@parties/updateJoin'
  payload: {
    partyId: string
    user: SbUserId
    time: number
    userInfo: SbUser
  }
}

export interface UpdateLeave {
  type: '@parties/updateLeave'
  payload: {
    partyId: string
    user: SbUserId
    time: number
  }
}

export interface UpdateLeaveSelf {
  type: '@parties/updateLeaveSelf'
  payload: {
    partyId: string
    time: number
  }
}

export interface UpdateLeaderChange {
  type: '@parties/updateLeaderChange'
  payload: {
    partyId: string
    leader: SbUserId
    time: number
  }
}

export interface UpdateChatMessage {
  type: '@parties/updateChatMessage'
  payload: {
    message: PartyChatMessage
    mentions: SbUser[]
  }
}

export interface UpdateKick {
  type: '@parties/updateKick'
  payload: {
    partyId: string
    target: SbUserId
    time: number
  }
}

export interface UpdateKickSelf {
  type: '@parties/updateKickSelf'
  payload: {
    partyId: string
    time: number
  }
}

export interface UpdateQueue {
  type: '@parties/updateQueue'
  payload: {
    partyId: string
    queueId: string
    matchmakingType: MatchmakingType
    accepted: Array<[userId: SbUserId, race: RaceChar]>
    unaccepted: SbUserId[]
    time: number
  }
}

export interface UpdateQueueCancel {
  type: '@parties/updateQueueCancel'
  payload: {
    partyId: string
    queueId: string
    reason: PartyQueueCancelReason
    time: number
  }
}

export interface UpdateQueueReady {
  type: '@parties/updateQueueReady'
  payload: {
    partyId: string
    queueId: string
    queuedMembers: Array<[userId: SbUserId, race: RaceChar]>
    time: number
  }
}
