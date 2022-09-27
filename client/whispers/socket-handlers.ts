import { NydusClient } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { WhisperEvent } from '../../common/whispers'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { dispatch, Dispatchable, ThunkAction } from '../dispatch-registry'
import windowFocus from '../window-focus'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in WhisperEvent['action']]: (event: Extract<WhisperEvent, { action: E }>) => Dispatchable
}

const eventToAction: EventToActionMap = {
  initSession2(event) {
    return {
      type: '@whispers/initSession',
      payload: {
        target: event.target,
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

  message(event): ThunkAction {
    return (dispatch, getState) => {
      const {
        relationships: { blocks },
        whispers: { sessions, byId: whispersById },
      } = getState()

      const isBlocked = blocks.has(event.message.from.id)
      if (!isBlocked) {
        // Notify the main process of the new message, so it can display an appropriate notification
        ipcRenderer.send('chatNewMessage', {
          urgent: true,
        })
      }

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

      const { from, to } = event.message
      const sessionId = sessions.has(from.id) ? from.id : to.id
      const session = whispersById.get(sessionId)
      if (!session) {
        return
      }

      if (!isBlocked && (!session.activated || !windowFocus.isFocused())) {
        audioManager.playSound(AvailableSound.MessageAlert)
      }
    }
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/whispers3/:userAndTarget', (route, event) => {
    const actionName = event.action as WhisperEvent['action']
    if (!eventToAction[actionName]) return

    const action = eventToAction[actionName]!(event)
    if (action) dispatch(action)
  })
}
