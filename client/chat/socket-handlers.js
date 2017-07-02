import { dispatch } from '../dispatch-registry'
import {
  CHAT_INIT_CHANNEL,
  CHAT_UPDATE_JOIN,
  CHAT_UPDATE_LEAVE,
  CHAT_UPDATE_LEAVE_SELF,
  CHAT_UPDATE_MESSAGE,
  CHAT_UPDATE_USER_ACTIVE,
  CHAT_UPDATE_USER_IDLE,
  CHAT_UPDATE_USER_OFFLINE,
} from '../actions'
import { NEW_CHAT_MESSAGE } from '../../app/common/ipc-constants'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

const eventToAction = {
  init(channel, event, siteSocket) {
    return {
      type: CHAT_INIT_CHANNEL,
      payload: {
        channel,
        activeUsers: event.activeUsers,
      },
    }
  },

  join(channel, event) {
    return {
      type: CHAT_UPDATE_JOIN,
      payload: {
        channel,
        user: event.user,
      },
    }
  },

  leave: (channel, event) => (dispatch, getState) => {
    const { auth } = getState()
    const user = auth.user.name
    if (user === event.user) {
      // It was us who left the channel
      dispatch({
        type: CHAT_UPDATE_LEAVE_SELF,
        payload: {
          channel,
        },
      })
    } else {
      dispatch({
        type: CHAT_UPDATE_LEAVE,
        payload: {
          channel,
          user: event.user,
          newOwner: event.newOwner,
        },
      })
    }
  },

  message(channel, event) {
    if (ipcRenderer) {
      // Notify the main process of the new message, so it can display an appropriate notification
      ipcRenderer.send(NEW_CHAT_MESSAGE, { user: event.user, message: event.data.text })
    }

    // TODO(tec27): handle different types of messages (event.data.type)
    return {
      type: CHAT_UPDATE_MESSAGE,
      payload: {
        channel,
        id: event.id,
        time: event.sent,
        user: event.user,
        message: event.data.text,
      },
    }
  },

  userActive(channel, event) {
    return {
      type: CHAT_UPDATE_USER_ACTIVE,
      payload: {
        channel,
        user: event.user,
      },
    }
  },

  userIdle(channel, event) {
    return {
      type: CHAT_UPDATE_USER_IDLE,
      payload: {
        channel,
        user: event.user,
      },
    }
  },

  userOffline(channel, event) {
    return {
      type: CHAT_UPDATE_USER_OFFLINE,
      payload: {
        channel,
        user: event.user,
      },
    }
  },
}

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/chat/:channel', (route, event) => {
    if (!eventToAction[event.action]) return

    const action = eventToAction[event.action](route.params.channel, event, siteSocket)
    if (action) dispatch(action)
  })
}
