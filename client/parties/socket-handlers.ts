import type { NydusClient, RouteHandler, RouteInfo } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { PartyEvent } from '../../common/parties'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch, Dispatchable } from '../dispatch-registry'
import { openSnackbar } from '../snackbars/action-creators'
import windowFocus from '../window-focus'
import { navigateToParty } from './action-creators'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in PartyEvent['type']]: (
    partyId: string,
    event: Extract<PartyEvent, { type: E }>,
  ) => Dispatchable
}

const eventToAction: EventToActionMap = {
  init: (partyId, event) => (dispatch, getState) => {
    const { party, time, userInfos } = event
    const selfUser = getState().auth.user

    dispatch({
      type: '@parties/init',
      payload: {
        party,
        time,
        userInfos,
      },
    })

    if (selfUser.id !== party.leader) {
      // If we have joined someone else's party, navigate to the party view immediately. Party
      // leaders are not navigated as they might want to invite more people from wherever they are.
      navigateToParty(party.id)
    }
  },

  invite: (partyId, event) => {
    const { invitedUser, time, userInfo } = event
    return {
      type: '@parties/updateInvite',
      payload: {
        partyId,
        invitedUser,
        time,
        userInfo,
      },
    }
  },

  uninvite: (partyId, event) => {
    const { target, time } = event
    return {
      type: '@parties/updateUninvite',
      payload: {
        partyId,
        target,
        time,
      },
    }
  },

  join: (partyId, event) => {
    const { user, userInfo, time } = event
    return {
      type: '@parties/updateJoin',
      payload: {
        partyId,
        user,
        userInfo,
        time,
      },
    }
  },

  leave: (partyId, event) => (dispatch, getState) => {
    const { user, time } = event
    const selfUser = getState().auth.user
    if (selfUser.id === user) {
      // It was us who left the party
      dispatch({
        type: '@parties/updateLeaveSelf',
        payload: {
          partyId,
          time,
        },
      })
    } else {
      dispatch({
        type: '@parties/updateLeave',
        payload: {
          partyId,
          user,
          time,
        },
      })
    }
  },

  leaderChange: (partyId, event) => {
    const { leader, time } = event
    return {
      type: '@parties/updateLeaderChange',
      payload: {
        partyId,
        leader,
        time,
      },
    }
  },

  chatMessage(partyId, event) {
    return (dispatch, getState) => {
      const {
        auth,
        party: { current },
        relationships: { blocks },
      } = getState()

      const isBlocked = blocks.has(event.message.user.id)
      if (!isBlocked) {
        // Notify the main process of the new message, so it can display an appropriate notification
        ipcRenderer.send('chatNewMessage', {
          urgent: event.mentions.some(m => m.id === auth.user.id),
        })
      }

      dispatch({
        type: '@parties/updateChatMessage',
        payload: event,
      })

      if (!isBlocked && (!current?.activated || !windowFocus.isFocused())) {
        audioManager.playSound(AvailableSound.MessageAlert)
      }
    }
  },

  kick: (partyId, event) => (dispatch, getState) => {
    const { target, time } = event
    const selfUser = getState().auth.user
    if (selfUser.id === target) {
      // It was us who has been kicked from the party
      dispatch(openSnackbar({ message: 'You have been kicked from the party.' }))
      dispatch({
        type: '@parties/updateKickSelf',
        payload: {
          partyId,
          time,
        },
      })
    } else {
      dispatch({
        type: '@parties/updateKick',
        payload: {
          partyId,
          target,
          time,
        },
      })
    }
  },

  queue: (partyId, event) => (dispatch, getState) => {
    const {
      auth: { user },
      party,
    } = getState()
    const showRaceDialog =
      party.current?.id === partyId &&
      event.unaccepted.includes(user.id) &&
      event.id !== party.current.queueState?.id

    dispatch({
      type: '@parties/updateQueue',
      payload: {
        partyId,
        queueId: event.id,
        matchmakingType: event.matchmakingType,
        accepted: event.accepted,
        unaccepted: event.unaccepted,
        time: event.time,
      },
    })

    if (showRaceDialog) {
      audioManager.playSound(AvailableSound.PartyQueue)
      dispatch(openDialog({ type: DialogType.PartyQueueAccept }))
    }
  },

  queueCancel: (partyId, event) => ({
    type: '@parties/updateQueueCancel',
    payload: {
      partyId,
      queueId: event.id,
      reason: event.reason,
      time: event.time,
    },
  }),

  queueReady: (partyId, event) => dispatch => {
    ipcRenderer.send('rallyPointRefreshPings')
    dispatch({
      type: '@parties/updateQueueReady',
      payload: {
        partyId,
        queueId: event.id,
        queuedMembers: event.queuedMembers,
        time: event.time,
      },
    })
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  const partiesHandler: RouteHandler = (route: RouteInfo, event: PartyEvent) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](route.params.partyId, event as any)
    if (action) dispatch(action)
  }

  siteSocket.registerRoute('/parties/:partyId', partiesHandler)
  siteSocket.registerRoute('/parties/invites/:partyId/:userId', partiesHandler)
}
