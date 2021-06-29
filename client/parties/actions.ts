import { PartyPayload, PartyUser } from '../../common/parties'
import { BaseFetchFailure } from '../network/fetch-action-types'

export type PartiesActions =
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
  | InitParty
  | InviteToParty
  | UninviteFromParty
  | DeclinePartyInvite
  | JoinParty
  | LeaveParty

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

export interface InitParty {
  type: '@parties/init'
  payload: {
    party: PartyPayload
  }
}

export interface InviteToParty {
  type: '@parties/invite'
  payload: {
    partyId: string
    invitedUser: PartyUser
  }
}

export interface UninviteFromParty {
  type: '@parties/uninvite'
  payload: {
    partyId: string
    target: PartyUser
  }
}

export interface DeclinePartyInvite {
  type: '@parties/decline'
  payload: {
    partyId: string
    target: PartyUser
  }
}

export interface JoinParty {
  type: '@parties/join'
  payload: {
    partyId: string
    user: PartyUser
  }
}

export interface LeaveParty {
  type: '@parties/leave'
  payload: {
    partyId: string
    user: PartyUser
  }
}
