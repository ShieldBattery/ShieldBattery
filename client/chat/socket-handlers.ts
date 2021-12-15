import { NydusClient } from 'nydus-client'
import { ChatEvent } from '../../common/chat'
import { TypedIpcRenderer } from '../../common/ipc'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { dispatch, Dispatchable } from '../dispatch-registry'
import windowFocus from '../window-focus'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in ChatEvent['action']]: (
    channel: string,
    event: Extract<ChatEvent, { action: E }>,
  ) => Dispatchable | undefined
}

const eventToAction: EventToActionMap = {
  init2(channel, event) {
    return {
      type: '@chat/initChannel',
      payload: event,
      meta: { channel },
    }
  },

  join2(channel, event) {
    return {
      type: '@chat/updateJoin',
      payload: event,
      meta: { channel },
    }
  },

  leave2: (channel, event) => (dispatch, getState) => {
    const { auth } = getState()
    if (auth.user.id === event.userId) {
      // It was us who left the channel
      dispatch({
        type: '@chat/updateLeaveSelf',
        meta: { channel },
      })
    } else {
      dispatch({
        type: '@chat/updateLeave',
        payload: event,
        meta: { channel },
      })
    }
  },

  message2(channel, event) {
    return (dispatch, getState) => {
      const {
        auth,
        chat: { byName },
      } = getState()

      const isUrgent = event.mentions.some(m => m.id === auth.user.id)
      // Notify the main process of the new message, so it can display an appropriate notification
      ipcRenderer.send('chatNewMessage', {
        user: event.user.name,
        message: event.message.text,
        urgent: isUrgent,
      })

      dispatch({
        type: '@chat/updateMessage',
        payload: event,
        meta: { channel },
      })

      const channelState = byName.get(channel.toLowerCase())
      if (isUrgent && channelState && (!channelState.activated || !windowFocus.isFocused())) {
        audioManager.playSound(AvailableSound.MessageAlert)
      }
    }
  },

  userActive2(channel, event) {
    return {
      type: '@chat/updateUserActive',
      payload: event,
      meta: { channel },
    }
  },

  userIdle2(channel, event) {
    return {
      type: '@chat/updateUserIdle',
      payload: event,
      meta: { channel },
    }
  },

  userOffline2(channel, event) {
    return {
      type: '@chat/updateUserOffline',
      payload: event,
      meta: { channel },
    }
  },

  // TODO(tec27): implement
  kick(channel, event) {
    return undefined
  },
  ban(channel, event) {
    return undefined
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/chat2/:channel', (route, event) => {
    const actionName = event.action as ChatEvent['action']
    if (!eventToAction[actionName]) return

    const action = eventToAction[actionName](route.params.channel, event)
    if (action) dispatch(action)
  })
}
