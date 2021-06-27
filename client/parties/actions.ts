import { PartyPayload, PartyUser } from '../../common/parties'
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
  | InitParty
  | UpdateInvite
  | UpdateUninvite
  | UpdateDecline
  | UpdateJoin
  | UpdateLeave
  | UpdateLeaveSelf

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
  }
}

export interface AcceptPartyInviteSuccess {
  type: '@parties/acceptPartyInvite'
  payload: void
  meta: {
    partyId: string
  }
  error?: false
}

export interface AcceptPartyInviteFailure extends BaseFetchFailure<'@parties/acceptPartyInvite'> {
  meta: {
    partyId: string
  }
}

export interface LeavePartyBegin {
  type: '@parties/leavePartyBegin'
}

export interface LeavePartySuccess {
  type: '@parties/leaveParty'
  payload: void
  error?: false
}

export type LeavePartyFailure = BaseFetchFailure<'@parties/leaveParty'>

export interface InitParty {
  type: '@parties/init'
  payload: {
    party: PartyPayload
  }
}

export interface UpdateInvite {
  type: '@parties/updateInvite'
  payload: {
    partyId: string
    invitedUser: PartyUser
  }
}

export interface UpdateUninvite {
  type: '@parties/updateUninvite'
  payload: {
    partyId: string
    target: PartyUser
  }
}

export interface UpdateDecline {
  type: '@parties/updateDecline'
  payload: {
    partyId: string
    target: PartyUser
  }
}

export interface UpdateJoin {
  type: '@parties/updateJoin'
  payload: {
    partyId: string
    user: PartyUser
  }
}

export interface UpdateLeave {
  type: '@parties/updateLeave'
  payload: {
    partyId: string
    user: PartyUser
  }
}

export interface UpdateLeaveSelf {
  type: '@parties/updateLeaveSelf'
}
