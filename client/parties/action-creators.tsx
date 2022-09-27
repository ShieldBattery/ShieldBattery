import { Immutable } from 'immer'
import React from 'react'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  defaultPreferences,
  MatchmakingPreferences,
  MatchmakingType,
  PartialMatchmakingPreferences,
} from '../../common/matchmaking'
import {
  AcceptFindMatchAsPartyRequest,
  AcceptPartyInviteRequest,
  ChangePartyLeaderRequest,
  FindMatchAsPartyRequest,
  InviteToPartyRequest,
  PartyServiceErrorCode,
  SendPartyChatMessageRequest,
} from '../../common/parties'
import { RaceChar } from '../../common/races'
import { apiUrl, urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user'
import { openSimpleDialog } from '../dialogs/action-creators'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import {
  updateLastQueuedMatchmakingType,
  updateMatchmakingPreferences,
} from '../matchmaking/action-creators'
import { push } from '../navigation/routing'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { clientId } from '../network/client-id'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { ActivateParty, DeactivateParty } from './actions'
import { AlreadySearchingErrorContent } from './find-match-error-content'

const ipcRenderer = new TypedIpcRenderer()

export function inviteToParty(
  target: { targetId: SbUserId } | { targetName: string },
): ThunkAction {
  return dispatch => {
    fetchJson<void>(apiUrl`parties/invites`, {
      method: 'POST',
      body: encodeBodyAsParams<InviteToPartyRequest>({
        ...target,
        clientId,
      }),
    }).catch(err => {
      let message = 'An error occurred while sending an invite'

      if (isFetchError(err) && err.code) {
        if (err.code === PartyServiceErrorCode.NotificationFailure) {
          message = 'Failed to send an invite. Please try again'
        } else if (err.code === PartyServiceErrorCode.AlreadyMember) {
          const user = (err.body as any)?.user?.name ?? 'The user'
          message = `${user} is already in your party`
        } else if (err.code === PartyServiceErrorCode.InvalidSelfAction) {
          message = "Can't invite yourself to the party"
        } else if (err.code === PartyServiceErrorCode.Blocked) {
          message = 'Failed to send invite, you have been blocked by this user'
        } else {
          logger.error(`Unhandled code when inviting to party: ${err.code}`)
        }
      } else {
        logger.error(`Error when inviting to party: ${err.stack ?? err}`)
      }

      dispatch(openSnackbar({ message, time: TIMING_LONG }))
    })
  }
}

export function removePartyInvite(partyId: string, targetId: SbUserId): ThunkAction {
  return dispatch => {
    fetchJson<void>(apiUrl`parties/invites/${partyId}/${targetId}`, {
      method: 'DELETE',
    }).catch(err => {
      logger.error(`Error while removing party invite: ${err.stack ?? err}`)
      // TODO(tec27): Handle codes
      dispatch(
        openSnackbar({
          message: 'An error occurred while removing an invite',
        }),
      )
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

    dispatch({
      type: '@parties/acceptPartyInvite',
      payload: fetchJson<void>(apiUrl`parties/${partyId}`, {
        method: 'POST',
        body: encodeBodyAsParams<AcceptPartyInviteRequest>({ clientId }),
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

    dispatch({
      type: '@parties/sendChatMessage',
      payload: fetchJson<void>(apiUrl`parties/${partyId}/messages`, {
        method: 'POST',
        body: encodeBodyAsParams<SendPartyChatMessageRequest>({ message }),
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
        body: encodeBodyAsParams<ChangePartyLeaderRequest>({ targetId }),
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
  matchmakingType: MatchmakingType,
  preferences: Immutable<MatchmakingPreferences> | Record<string, never>,
  partyId: string,
): ThunkAction {
  return (dispatch, getState) => {
    const {
      auth: { user },
      mapPools: { byType: mapPoolByType },
    } = getState()
    const selfId = user.id

    const prefs =
      !!preferences && 'race' in preferences
        ? (preferences as Immutable<MatchmakingPreferences>)
        : defaultPreferences(
            matchmakingType,
            selfId,
            preferences?.mapPoolId ?? mapPoolByType.get(matchmakingType)?.id ?? 1,
          )

    const promise = Promise.resolve().then(async () => {
      const identifiers = (await ipcRenderer.invoke('securityGetClientIds')) ?? []
      const body: FindMatchAsPartyRequest = {
        preferences: prefs,
        identifiers,
      }
      return fetchJson<void>(apiUrl`parties/${partyId}/find-match`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    })

    promise.catch(err => {
      let dialogMessage: React.ReactNode = 'Something went wrong :('

      if (isFetchError(err) && err.code) {
        switch (err.code) {
          case PartyServiceErrorCode.NotFoundOrNotInParty:
            dialogMessage = "Party not found or you're not in it"
            break
          case PartyServiceErrorCode.InsufficientPermissions:
            dialogMessage = 'Only party leaders can queue for matchmaking'
            break
          case PartyServiceErrorCode.AlreadyInGameplayActivity:
            dialogMessage = 'The party is already searching for a different matchmaking type'
            const body = err.body as any
            if (body.users && Array.isArray(body.users)) {
              dialogMessage = <AlreadySearchingErrorContent users={body.users as SbUserId[]} />
            }
            break
          case PartyServiceErrorCode.InvalidAction:
            dialogMessage = 'The party is too large for that matchmaking type'
            break
          default:
            logger.error(
              `Unhandled error code while queueing for matchmaking as a party: ${err.code}`,
            )
            break
        }
      } else {
        logger.error(`Error while queuing for matchmaking as a party: ${err?.stack ?? err}`)
      }
      dispatch(openSimpleDialog('Error searching for a match', dialogMessage, true))
    })

    dispatch(updateLastQueuedMatchmakingType(matchmakingType))
    dispatch({
      type: '@parties/findMatchAsParty',
      payload: promise,
      meta: { partyId, preferences: prefs },
    })
  }
}

export function acceptFindMatchAsParty(
  partyId: string,
  queueId: string,
  matchmakingType: MatchmakingType,
  race: RaceChar,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const identifiers = (await ipcRenderer.invoke('securityGetClientIds')) ?? []
    const body: AcceptFindMatchAsPartyRequest = { race, identifiers }

    dispatch((_, getState) => {
      const {
        auth: {
          user: { id: selfId },
        },
      } = getState()

      const newPreferences: PartialMatchmakingPreferences = {
        userId: selfId,
        matchmakingType,
        race,
      }
      dispatch(updateMatchmakingPreferences(matchmakingType, newPreferences))
    })

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
