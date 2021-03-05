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
  addInvite: (partyId, event) => {
    const { from } = event
    return {
      type: '@parties/addInvite',
      payload: {
        partyId,
        from,
      },
    }
  },

  removeInvite: (partyId, event) => {
    return {
      type: '@parties/removeInvite',
      payload: {
        partyId,
      },
    }
  },

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
    const { invites } = event
    return {
      type: '@parties/invite',
      payload: {
        invites,
      },
    }
  },

  decline: (partyId, event) => {
    const { target } = event
    return {
      type: '@parties/decline',
      payload: {
        target,
      },
    }
  },

  join: (partyId, event) => {
    const { user } = event
    return {
      type: '@parties/join',
      payload: {
        user,
      },
    }
  },

  leave: (partyId, event) => {
    const { user } = event
    return {
      type: '@parties/leave',
      payload: {
        user,
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
