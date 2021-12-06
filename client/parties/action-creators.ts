import { Immutable } from 'immer'
import { MatchmakingPreferences } from '../../common/matchmaking'
import {
  AcceptFindMatchAsPartyRequest,
  AcceptPartyInviteRequest,
  FindMatchAsPartyRequest,
  InviteToPartyRequest,
  PartyServiceErrorCode,
  SendPartyChatMessageRequest,
} from '../../common/parties'
import { RaceChar } from '../../common/races'
import { apiUrl, urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/user-info'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { updateLastQueuedMatchmakingType } from '../matchmaking/action-creators'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { clientId } from '../network/client-id'
import { fetchJson } from '../network/fetch'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { ActivateParty, DeactivateParty } from './actions'

export function inviteToParty(targetId: SbUserId): ThunkAction {
  return dispatch => {
    const params = { clientId, targetId }
    dispatch({
      type: '@parties/inviteToPartyBegin',
      payload: params,
    })

    const requestBody: InviteToPartyRequest = { clientId, targetId }
    dispatch({
      type: '@parties/inviteToParty',
      payload: fetchJson<void>(apiUrl`parties/invites`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }).catch(err => {
        let message = 'An error occurred while sending an invite'
        if (err.body.code === PartyServiceErrorCode.NotificationFailure) {
          message = 'Failed to send an invite. Please try again'
        } else if (err.body.code === PartyServiceErrorCode.AlreadyMember) {
          const user = err.body.user?.name ?? 'The user'
          message = `${user} is already in your party`
        } else if (err.body.code === PartyServiceErrorCode.InvalidSelfAction) {
          message = "Can't invite yourself to the party"
        }

        dispatch(openSnackbar({ message, time: TIMING_LONG }))
        throw err
      }),
      meta: params,
    })
  }
}

export function removePartyInvite(partyId: string, targetId: SbUserId): ThunkAction {
  return dispatch => {
    const params = { partyId, targetId }
    dispatch({
      type: '@parties/removePartyInviteBegin',
      payload: params,
    })

    dispatch({
      type: '@parties/removePartyInvite',
      payload: fetchJson<void>(apiUrl`parties/invites/${partyId}/${targetId}`, {
        method: 'DELETE',
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while removing an invite',
          }),
        )
        throw err
      }),
      meta: params,
    })
  }
}

export function declinePartyInvite(partyId: string): ThunkAction {
  return dispatch => {
    const params = { partyId }
    dispatch({
      type: '@parties/declinePartyInviteBegin',
      payload: params,
    })

    dispatch({
      type: '@parties/declinePartyInvite',
      payload: fetchJson<void>(apiUrl`parties/invites/${partyId}`, {
        method: 'DELETE',
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while declining an invite',
          }),
        )
        throw err
      }),
      meta: params,
    })
  }
}

export function acceptPartyInvite(partyId: string): ThunkAction {
  return dispatch => {
    const params = { partyId, clientId }
    dispatch({
      type: '@parties/acceptPartyInviteBegin',
      payload: params,
    })

    const requestBody: AcceptPartyInviteRequest = { clientId }
    dispatch({
      type: '@parties/acceptPartyInvite',
      payload: fetchJson<void>(apiUrl`parties/${partyId}`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }).catch(err => {
        let message = 'An error occurred while accepting an invite'
        if (err.body.code === PartyServiceErrorCode.NotFoundOrNotInvited) {
          message = "Party doesn't exist anymore"
        } else if (err.body.code === PartyServiceErrorCode.PartyFull) {
          message = 'Party is full'
        }

        dispatch(openSnackbar({ message, time: TIMING_LONG }))
        throw err
      }),
      meta: params,
    })
  }
}

export function leaveParty(partyId: string): ThunkAction {
  return dispatch => {
    const params = { partyId, clientId }
    dispatch({
      type: '@parties/leavePartyBegin',
      payload: params,
    })

    dispatch({
      type: '@parties/leaveParty',
      payload: fetchJson<void>(apiUrl`parties/${partyId}/${clientId}?type=leave`, {
        method: 'DELETE',
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while leaving the party',
          }),
        )
        throw err
      }),
      meta: params,
    })
  }
}

export function sendChatMessage(partyId: string, message: string): ThunkAction {
  return dispatch => {
    const params = { partyId, message }
    dispatch({
      type: '@parties/sendChatMessageBegin',
      payload: params,
    })

    const requestBody: SendPartyChatMessageRequest = { message }
    dispatch({
      type: '@parties/sendChatMessage',
      payload: fetchJson<void>(apiUrl`parties/${partyId}/messages`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }),
      meta: params,
    })
  }
}

export function kickPlayer(partyId: string, targetId: SbUserId): ThunkAction {
  return dispatch => {
    const params = { partyId, targetId }
    dispatch({
      type: '@parties/kickFromPartyBegin',
      payload: params,
    })

    dispatch({
      type: '@parties/kickFromParty',
      payload: fetchJson<void>(apiUrl`parties/${partyId}/${targetId}?type=kick`, {
        method: 'DELETE',
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while kicking the player',
          }),
        )
        throw err
      }),
      meta: params,
    })
  }
}

export function changeLeader(partyId: string, targetId: SbUserId): ThunkAction {
  return dispatch => {
    const params = { partyId, targetId }
    dispatch({
      type: '@parties/changePartyLeaderBegin',
      payload: params,
    })

    dispatch({
      type: '@parties/changePartyLeader',
      payload: fetchJson<void>(apiUrl`parties/${partyId}/change-leader`, {
        method: 'POST',
        body: JSON.stringify({ targetId }),
      }).catch(err => {
        dispatch(
          openSnackbar({
            message: 'An error occurred while changing the leader',
          }),
        )
        throw err
      }),
      meta: params,
    })
  }
}

export function activateParty(partyId: string): ActivateParty {
  return {
    type: '@parties/activateParty',
    payload: { partyId },
  }
}

export function deactivateParty(partyId: string): DeactivateParty {
  return {
    type: '@parties/deactivateParty',
    payload: { partyId },
  }
}

export function findMatchAsParty(
  preferences: Immutable<MatchmakingPreferences>,
  partyId: string,
): ThunkAction {
  return dispatch => {
    const body: FindMatchAsPartyRequest = {
      preferences,
    }
    const promise = fetchJson<void>(apiUrl`parties/${partyId}/find-match`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    promise.catch(err => {
      logger.error(`Error while queuing for matchmaking as a party: ${err?.stack ?? err}`)
      dispatch(
        openSnackbar({
          message: 'An error occurred while queueing for matchmaking',
        }),
      )
    })

    dispatch(updateLastQueuedMatchmakingType(preferences.matchmakingType))
    dispatch({
      type: '@parties/findMatchAsParty',
      payload: promise,
      meta: { partyId, preferences },
    })
  }
}

export function acceptFindMatchAsParty(
  partyId: string,
  queueId: string,
  race: RaceChar,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const body: AcceptFindMatchAsPartyRequest = { race }

    await fetchJson<void>(apiUrl`parties/${partyId}/find-match/${queueId}`, {
      signal: spec.signal,
      method: 'post',
      body: JSON.stringify(body),
    })
  })
}

export function cancelFindMatchAsParty(
  partyId: string,
  queueId: string,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`parties/${partyId}/find-match/${queueId}`, {
      signal: spec.signal,
      method: 'delete',
    })
  })
}

export function navigateToParty(partyId: string) {
  push(urlPath`/parties/${partyId}`)
}
