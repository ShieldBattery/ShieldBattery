import { AcceptPartyInviteServerBody, InviteToPartyServerBody } from '../../common/parties'
import { ThunkAction } from '../dispatch-registry'
import { clientId } from '../network/client-id'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
import { openSnackbar } from '../snackbars/action-creators'

export function inviteToParty(targetId: number): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@parties/inviteToPartyBegin',
    })

    const requestBody: InviteToPartyServerBody = { clientId, targetId }
    dispatch({
      type: '@parties/inviteToParty',
      payload: fetch<void>(apiUrl`parties/invites`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while sending an invite',
          }),
        )
        throw err
      }),
    })
  }
}

export function removePartyInvite(partyId: string, targetId: number): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@parties/removePartyInviteBegin',
    })

    dispatch({
      type: '@parties/removePartyInvite',
      payload: fetch<void>(apiUrl`parties/invites/${partyId}/${targetId}`, {
        method: 'DELETE',
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while removing an invite',
          }),
        )
        throw err
      }),
    })
  }
}

export function declinePartyInvite(partyId: string): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@parties/declinePartyInviteBegin',
    })

    dispatch({
      type: '@parties/declinePartyInvite',
      payload: fetch<void>(apiUrl`parties/invites/${partyId}`, {
        method: 'DELETE',
      }).catch(err => {
        // TODO(2Pac): Show an actual reason why the this failed (e.g. party doesn't exist anymore)
        dispatch(
          openSnackbar({
            message: 'An error occurred while declining an invite',
          }),
        )
        throw err
      }),
    })
  }
}

export function acceptPartyInvite(partyId: string): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@parties/acceptPartyInviteBegin',
    })

    const requestBody: AcceptPartyInviteServerBody = { clientId }
    dispatch({
      type: '@parties/acceptPartyInvite',
      payload: fetch<void>(apiUrl`parties/${partyId}`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }).catch(err => {
        // TODO(2Pac): Show an actual reason why the this failed (e.g. party doesn't exist anymore)
        dispatch(
          openSnackbar({
            message: 'An error occurred while accepting an invite',
          }),
        )
        throw err
      }),
    })
  }
}
