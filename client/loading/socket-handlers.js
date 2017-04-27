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
  const loadingHandler = (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](event, siteSocket)
    if (action) dispatch(action)
  }
  siteSocket.registerRoute('/users/:userId/:area?', loadingHandler)
  siteSocket.registerRoute('/clients/:userClientId/:area?', loadingHandler)
}
