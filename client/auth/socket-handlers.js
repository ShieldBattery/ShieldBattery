import { dispatch } from '../dispatch-registry'
import { AUTH_UPDATE_EMAIL_VERIFIED } from '../actions'

const eventToAction = {
  emailVerified() {
    return {
      type: AUTH_UPDATE_EMAIL_VERIFIED,
    }
  },
}

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/userProfiles/:userId', (route, event) => {
    if (!eventToAction[event.action]) return

    const action = eventToAction[event.action](event)
    if (action) dispatch(action)
  })
}
