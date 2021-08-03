import type { NydusClient } from 'nydus-client'
import { EMAIL_VERIFICATION_ID } from '../../common/notifications'
import { ReduxAction } from '../action-types'
import { dispatch, Dispatchable } from '../dispatch-registry'
import { clearNotificationById } from '../notifications/action-creators'

// TODO(tec27): Improve the types around all of this so that we know the event types and such
const eventToAction: Record<string, (event: any) => Dispatchable<ReduxAction> | undefined> = {
  emailVerified() {
    return dispatch => {
      dispatch({
        type: '@auth/emailVerified',
        payload: undefined,
      })
      dispatch(clearNotificationById(EMAIL_VERIFICATION_ID))
    }
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/userProfiles/:userId', (route, event) => {
    if (!eventToAction.hasOwnProperty(event.action)) return

    const action = eventToAction[event.action](event)
    if (action) dispatch(action)
  })
}
