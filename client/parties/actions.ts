import { PartyPayload, PartyUser } from '../../common/parties'
import { User } from '../../common/users/user-info'
import { BaseFetchFailure } from '../network/fetch-action-types'

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
  | SendChatMessage
  | SendChatMessageFailure
  | ActivateParty
  | DeactivateParty
  | InitParty
  | UpdateInvite
  | UpdateUninvite
  | UpdateDecline
  | UpdateJoin
  | UpdateLeave
  | UpdateLeaveSelf
  | UpdateChatMessage

export interface InviteToPartyBegin {
  type: '@parties/inviteToPartyBegin'
  payload: {
    clientId: string
    targetId: number
  }
}

export interface InviteToPartySuccess {
  type: '@parties/inviteToParty'
  payload: void
  meta: {
    clientId: string
    targetId: number
  }
  error?: false
}

export interface InviteToPartyFailure extends BaseFetchFailure<'@parties/inviteToParty'> {
  meta: {
    clientId: string
    targetId: number
  }
}

export interface RemovePartyInviteBegin {
  type: '@parties/removePartyInviteBegin'
  payload: {
    partyId: string
    targetId: number
  }
}

export interface RemovePartyInviteSuccess {
  type: '@parties/removePartyInvite'
  payload: void
  meta: {
    partyId: string
    targetId: number
  }
  error?: false
}

export interface RemovePartyInviteFailure extends BaseFetchFailure<'@parties/removePartyInvite'> {
  meta: {
    partyId: string
    targetId: number
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
export interface SendChatMessage {
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
    party: PartyPayload
    time: number
    userInfos: User[]
  }
}

export interface UpdateInvite {
  type: '@parties/updateInvite'
  payload: {
    partyId: string
    invitedUser: PartyUser
    time: number
    userInfo: User
  }
}

export interface UpdateUninvite {
  type: '@parties/updateUninvite'
  payload: {
    partyId: string
    target: PartyUser
    time: number
  }
}

export interface UpdateDecline {
  type: '@parties/updateDecline'
  payload: {
    partyId: string
    target: PartyUser
    time: number
  }
}

export interface UpdateJoin {
  type: '@parties/updateJoin'
  payload: {
    partyId: string
    user: PartyUser
    time: number
  }
}

export interface UpdateLeave {
  type: '@parties/updateLeave'
  payload: {
    partyId: string
    user: PartyUser
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

export interface UpdateChatMessage {
  type: '@parties/updateChatMessage'
  payload: {
    partyId: string
    from: PartyUser
    time: number
    text: string
  }
}
