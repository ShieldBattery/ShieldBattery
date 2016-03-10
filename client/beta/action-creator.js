import fetch from '../network/fetch'
import {
  BETA_CREATE_INVITE_BEGIN,
  BETA_CREATE_INVITE,
} from '../actions'

export function createInvite(invite) {
  return dispatch => {
    dispatch({
      type: BETA_CREATE_INVITE_BEGIN
    })

    dispatch({
      type: BETA_CREATE_INVITE,
      payload: fetch('/api/1/invites', {
        method: 'post',
        body: JSON.stringify({
          invite
        })
      })
    })
  }
}
