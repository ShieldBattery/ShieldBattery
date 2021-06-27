import type { NydusClient, RouteHandler, RouteInfo } from 'nydus-client'
import { PartyEvent } from '../../common/parties'
import { dispatch, Dispatchable } from '../dispatch-registry'

type EventToActionMap = {
  [E in PartyEvent['type']]?: (
    partyId: string,
    event: Extract<PartyEvent, { type: E }>,
  ) => Dispatchable
}

const eventToAction: EventToActionMap = {
  init: (partyId, event) => {
    const { party } = event
    return {
      type: '@parties/init',
      payload: {
        party,
      },
    }
  },

  invite: (partyId, event) => {
    const { invitedUser } = event
    return {
      type: '@parties/updateInvite',
      payload: {
        partyId,
        invitedUser,
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
