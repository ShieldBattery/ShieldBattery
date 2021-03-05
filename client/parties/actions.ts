import { PartyPayload, PartyUser } from '../../common/parties'
import { BaseFetchFailure } from '../network/fetch-action-types'

export type PartiesActions =
  | InviteToPartyBegin
  | InviteToPartySuccess
  | BaseFetchFailure<'@parties/inviteToParty'>
  | DeclinePartyInviteBegin
  | DeclinePartyInviteSuccess
  | BaseFetchFailure<'@parties/declinePartyInvite'>
  | AcceptPartyInviteBegin
  | AcceptPartyInviteSuccess
  | BaseFetchFailure<'@parties/acceptPartyInvite'>
  | AddInvite
  | RemoveInvite
  | Init
  | Invite
  | Decline
  | Join
  | Leave

export interface InviteToPartyBegin {
  type: '@parties/inviteToPartyBegin'
}

export interface InviteToPartySuccess {
  type: '@parties/inviteToParty'
  payload: void
  error?: false
}

export interface DeclinePartyInviteBegin {
  type: '@parties/declinePartyInviteBegin'
}

export interface DeclinePartyInviteSuccess {
  type: '@parties/declinePartyInvite'
  payload: void
  error?: false
}

export interface AcceptPartyInviteBegin {
  type: '@parties/acceptPartyInviteBegin'
}

export interface AcceptPartyInviteSuccess {
  type: '@parties/acceptPartyInvite'
  payload: void
  error?: false
}

export interface AddInvite {
  type: '@parties/addInvite'
  payload: {
    partyId: string
    from: PartyUser
  }
}

export interface RemoveInvite {
  type: '@parties/removeInvite'
  payload: {
    partyId: string
  }
}

export interface Init {
  type: '@parties/init'
  payload: {
    party: PartyPayload
  }
}

export interface Invite {
  type: '@parties/invite'
  payload: {
    invites: PartyUser[]
  }
}

export interface Decline {
  type: '@parties/decline'
  payload: {
    target: PartyUser
  }
}

export interface Join {
  type: '@parties/join'
  payload: {
    user: PartyUser
  }
}

export interface Leave {
  type: '@parties/leave'
  payload: {
    user: PartyUser
  }
}
