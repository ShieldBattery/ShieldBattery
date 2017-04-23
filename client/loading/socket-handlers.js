import { dispatch } from '../dispatch-registry'
import {
  CHAT_LOADING_COMPLETE,
  SUBSCRIPTIONS_CLIENT_LOADING_COMPLETE,
  SUBSCRIPTIONS_USER_LOADING_COMPLETE,
  WHISPERS_LOADING_COMPLETE,
} from '../actions'

const eventToAction = {
  chatReady() {
    return {
      type: CHAT_LOADING_COMPLETE,
    }
  },

  subscribedClient() {
    return {
      type: SUBSCRIPTIONS_CLIENT_LOADING_COMPLETE,
    }
  },

  subscribedUser() {
    return {
      type: SUBSCRIPTIONS_USER_LOADING_COMPLETE,
    }
  },

  whispersReady() {
    return {
      type: WHISPERS_LOADING_COMPLETE,
    }
  },
}

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/users/:userId/:area?', (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](event, siteSocket)
    if (action) dispatch(action)
  })
}
