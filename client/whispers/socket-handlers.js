import { dispatch } from '../dispatch-registry'
import {
  WHISPERS_UPDATE_INIT_SESSION,
  WHISPERS_UPDATE_CLOSE_SESSION,
  WHISPERS_UPDATE_MESSAGE,
  WHISPERS_UPDATE_USER_ACTIVE,
  WHISPERS_UPDATE_USER_IDLE,
  WHISPERS_UPDATE_USER_OFFLINE,
} from '../actions'
import { NEW_CHAT_MESSAGE } from '../../app/common/ipc-constants'

const ipcRenderer =
  process.webpackEnv.SB_ENV === 'electron' ? require('electron').ipcRenderer : null

const eventToAction = {
  initSession(event, siteSocket) {
    return {
      type: WHISPERS_UPDATE_INIT_SESSION,
      payload: {
        target: event.target,
        targetStatus: event.targetStatus,
      },
    }
  },

  closeSession(event, siteSocket) {
    return {
      type: WHISPERS_UPDATE_CLOSE_SESSION,
      payload: {
        target: event.target,
      },
    }
  },

  message(event) {
    if (ipcRenderer) {
      // Notify the main process of the new message, so it can display an appropriate notification
      ipcRenderer.send(NEW_CHAT_MESSAGE, { user: event.from, message: event.data.text })
    }

    return {
      type: WHISPERS_UPDATE_MESSAGE,
      payload: {
        id: event.id,
        time: event.sent,
        from: event.from,
        to: event.to,
        message: event.data.text,
      },
    }
  },

  userActive(event) {
    return {
      type: WHISPERS_UPDATE_USER_ACTIVE,
      payload: {
        user: event.target,
      },
    }
  },

  userIdle(event) {
    return {
      type: WHISPERS_UPDATE_USER_IDLE,
      payload: {
        user: event.target,
      },
    }
  },

  userOffline(event) {
    return {
      type: WHISPERS_UPDATE_USER_OFFLINE,
      payload: {
        user: event.target,
      },
    }
  },
}

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/whispers/:userAndTarget', (route, event) => {
    if (!eventToAction[event.action]) return

    const action = eventToAction[event.action](event, siteSocket)
    if (action) dispatch(action)
  })
}
