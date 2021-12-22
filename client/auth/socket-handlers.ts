import type { NydusClient, RouteInfo } from 'nydus-client'
import { EMAIL_VERIFICATION_ID } from '../../common/notifications'
import { AuthEvent } from '../../common/users/sb-user'
import { dispatch, Dispatchable, ThunkAction } from '../dispatch-registry'
import { clearNotificationById } from '../notifications/action-creators'

type EventToActionMap = {
  [E in AuthEvent['action']]: (event: Extract<AuthEvent, { action: E }>) => Dispatchable | undefined
}

const eventToAction: Readonly<EventToActionMap> = {
  emailVerified(): ThunkAction {
    return dispatch => {
      dispatch({
        type: '@auth/emailVerified',
        payload: undefined,
      })
      dispatch(clearNotificationById(EMAIL_VERIFICATION_ID))
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
    if (!eventToAction.hasOwnProperty(event.action)) return

    const action = eventToAction[event.action](event as any)
    if (action) dispatch(action)
  })
}
