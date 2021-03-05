import { ThunkAction } from '../dispatch-registry'
import { clientId } from '../network/client-id'
import fetch from '../network/fetch'
import { apiUrl } from '../network/urls'
import { openSnackbar } from '../snackbars/action-creators'

export function inviteToParty(users: string[]): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@parties/inviteToPartyBegin',
    })

    dispatch({
      type: '@parties/inviteToParty',
      payload: fetch<void>(apiUrl`parties/invites`, {
        method: 'post',
        body: JSON.stringify({ clientId, targets: users }),
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

export function declinePartyInvite(partyId: string): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@parties/declinePartyInviteBegin',
    })

    dispatch({
      type: '@parties/declinePartyInvite',
      payload: fetch<void>(apiUrl`parties/invites/${partyId}`, {
        method: 'delete',
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

    dispatch({
      type: '@parties/acceptPartyInvite',
      payload: fetch<void>(apiUrl`parties/${partyId}`, {
        method: 'post',
        body: JSON.stringify({ clientId }),
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
