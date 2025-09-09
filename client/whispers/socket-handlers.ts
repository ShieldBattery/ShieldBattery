import { NydusClient } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { WhisperEvent } from '../../common/whispers'
import { audioManager, AvailableSound } from '../audio/audio-manager'
import { dispatch, Dispatchable, ThunkAction } from '../dispatch-registry'
import windowFocus from '../dom/window-focus'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in WhisperEvent['action']]: (event: Extract<WhisperEvent, { action: E }>) => Dispatchable
}

const eventToAction: EventToActionMap = {
  initSession3(event) {
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
        auth: { self },
        relationships: { blocks },
        whispers: { byId: whispersById },
      } = getState()

      if (!self) {
        return
      }

      const isBlocked = blocks.has(event.message.from.id)
      if (!isBlocked) {
        // Notify the main process of the new message, so it can display an appropriate notification
        ipcRenderer.send('chatNewMessage', {
          urgent: true,
        })
      }

      const { from, to } = event.message
      const target = self.user.id === to.id ? from.id : to.id
      dispatch({
        type: '@whispers/updateMessage',
        payload: event,
        meta: { target },
      })

      const session = whispersById.get(target)
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
