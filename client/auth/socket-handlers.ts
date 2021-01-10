import type { NydusClient } from 'nydus-client'
import { ReduxAction } from '../action-types'
import { dispatch, Dispatchable } from '../dispatch-registry'

// TODO(tec27): Improve the types around all of this so that we know the event types and such
const eventToAction: Record<string, (event: any) => Dispatchable<ReduxAction> | undefined> = {
  emailVerified() {
    return {
      type: '@auth/emailVerified',
      payload: undefined,
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
