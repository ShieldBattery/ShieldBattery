import { NydusClient } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { WhisperEvent, WhisperUserEvent } from '../../common/whispers'
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

      const isBlocked = blocks.has(event.message.from)
      const windowFocused = windowFocus.isFocused()
      if (!isBlocked) {
        // Notify the main process of the new message, so it can display an appropriate notification
        ipcRenderer.send('chatNewMessage', {
          urgent: true,
        })
      }

      const { from, to } = event.message
      const target = self.user.id === to ? from : to
      dispatch({
        type: '@whispers/updateMessage',
        payload: event,
        meta: { target, windowFocused },
      })

      const session = whispersById.get(target)
      if (!session) {
        return
      }

      if (!isBlocked && (!session.activated || !windowFocused)) {
        audioManager.playSound(AvailableSound.MessageAlert)
      }
    }
  },
}

type EventToUserActionMap = {
  [E in WhisperUserEvent['action']]: (
    event: Extract<WhisperUserEvent, { action: E }>,
  ) => Dispatchable
}

const eventToUserAction: EventToUserActionMap = {
  lastReadTimeChanged(event) {
    return {
      type: '@whispers/updateLastReadTime',
      payload: {
        targetId: event.target,
        lastReadTime: event.lastReadTime,
      },
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

  siteSocket.registerRoute('/whispers3/users/:userId', (route, event: WhisperUserEvent) => {
    if (!Object.hasOwn(eventToUserAction, event.action)) return

    const action = eventToUserAction[event.action](event as any)
    if (action) dispatch(action)
  })
}
