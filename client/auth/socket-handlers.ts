import type { NydusClient, RouteInfo } from 'nydus-client'
import { RestrictionEvent } from '../../common/users/restrictions'
import { AuthEvent } from '../../common/users/user-network'
import { Dispatchable, dispatch } from '../dispatch-registry'

type EventToActionMap = {
  [E in AuthEvent['action']]: (event: Extract<AuthEvent, { action: E }>) => Dispatchable | undefined
}

const eventToAction: Readonly<EventToActionMap> = {
  emailChanged(event) {
    return {
      type: '@auth/emailChanged',
      payload: event,
    }
  },

  emailVerified() {
    return {
      type: '@auth/emailVerified',
    }
  },

  permissionsChanged(event) {
    return {
      type: '@auth/permissionsChanged',
      payload: {
        userId: event.userId,
        permissions: event.permissions,
      },
    }
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/userProfiles/:userId', (route: RouteInfo, event: AuthEvent) => {
    if (!Object.hasOwn(eventToAction, event.action)) return

    const action = eventToAction[event.action](event as any)
    if (action) dispatch(action)
  })

  siteSocket.registerRoute('/restrictions/:userId', (route: RouteInfo, event: RestrictionEvent) => {
    if (event.type === 'restrictionsChanged') {
      dispatch({
        type: '@auth/restrictionsChanged',
        payload: {
          restrictions: event.restrictions,
        },
      })
    }
  })
}
