import type { NydusClient, RouteHandler, RouteInfo } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { PartyEvent } from '../../common/parties'
import { dispatch, Dispatchable } from '../dispatch-registry'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in PartyEvent['type']]?: (
    partyId: string,
    event: Extract<PartyEvent, { type: E }>,
  ) => Dispatchable
}

const eventToAction: EventToActionMap = {
  init: (partyId, event) => {
    const { party, userInfos } = event
    return {
      type: '@parties/init',
      payload: {
        party,
        userInfos,
      },
    }
  },

  invite: (partyId, event) => {
    const { invitedUser, userInfo } = event
    return {
      type: '@parties/updateInvite',
      payload: {
        partyId,
        invitedUser,
        userInfo,
      },
    }
  },

  uninvite: (partyId, event) => {
    const { target } = event
    return {
      type: '@parties/updateUninvite',
      payload: {
        partyId,
        target,
      },
    }
  },

  decline: (partyId, event) => {
    const { target } = event
    return {
      type: '@parties/updateDecline',
      payload: {
        partyId,
        target,
      },
    }
  },

  join: (partyId, event) => {
    const { user } = event
    return {
      type: '@parties/updateJoin',
      payload: {
        partyId,
        user,
      },
    }
  },

  leave: (partyId, event) => (dispatch, getState) => {
    const { auth } = getState()
    if (auth.user.id === event.user.id) {
      // It was us who left the party
      dispatch({
        type: '@parties/updateLeaveSelf',
      })
    } else {
      dispatch({
        type: '@parties/updateLeave',
        payload: {
          partyId,
          user: event.user,
        },
      })
    }
  },

  chatMessage(partyId, event) {
    const { from, time, text } = event

    // Notify the main process of the new message, so it can display an appropriate notification
    ipcRenderer.send('chatNewMessage', { user: event.from.name, message: event.text })

    return {
      type: '@parties/updateChatMessage',
      payload: {
        partyId,
        from,
        time,
        text,
      },
    }
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  const partiesHandler: RouteHandler = (route: RouteInfo, event: PartyEvent) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type]!(route.params.partyId, event as any)
    if (action) dispatch(action)
  }

  siteSocket.registerRoute('/parties/:partyId', partiesHandler)
  siteSocket.registerRoute('/parties/invites/:partyId/:userId', partiesHandler)
}
