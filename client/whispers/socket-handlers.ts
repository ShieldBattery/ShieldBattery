import { NydusClient } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { WhisperEvent } from '../../common/whispers'
import { dispatch, Dispatchable } from '../dispatch-registry'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in WhisperEvent['action']]?: (event: Extract<WhisperEvent, { action: E }>) => Dispatchable
}

const eventToAction: EventToActionMap = {
  initSession(event) {
    return {
      type: '@whispers/initSession',
      payload: {
        target: event.target,
        targetStatus: event.targetStatus,
      },
    }
  },

  closeSession(event) {
    return {
      type: '@whispers/closeSession',
      payload: {
        target: event.target,
      },
    }
  },

  message(event) {
    return (dispatch, getState) => {
      const { auth } = getState()

      // Notify the main process of the new message, so it can display an appropriate notification
      ipcRenderer.send('chatNewMessage', {
        user: event.message.from.name,
        message: event.message.data.text,
        urgent: !!event.mentions.find(m => m.id === auth.user.id),
      })

      dispatch({
        type: '@whispers/updateMessage',
        payload: {
          message: {
            id: event.message.id,
            time: event.message.sent,
            from: event.message.from,
            to: event.message.to,
            text: event.message.data.text,
          },
          users: event.users,
          mentions: event.mentions,
        },
      })
    }
  },

  userActive(event) {
    return {
      type: '@whispers/updateUserActive',
      payload: {
        user: event.target,
      },
    }
  },

  userIdle(event) {
    return {
      type: '@whispers/updateUserIdle',
      payload: {
        user: event.target,
      },
    }
  },

  userOffline(event) {
    return {
      type: '@whispers/updateUserOffline',
      payload: {
        user: event.target,
      },
    }
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/whispers2/:userAndTarget', (route, event) => {
    const actionName = event.action as WhisperEvent['action']
    if (!eventToAction[actionName]) return

    const action = eventToAction[actionName]!(event)
    if (action) dispatch(action)
  })
}
