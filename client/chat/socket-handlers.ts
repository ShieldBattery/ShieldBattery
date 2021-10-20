import { NydusClient } from 'nydus-client'
import { ChatEvent, ServerChatMessageType } from '../../common/chat'
import { TypedIpcRenderer } from '../../common/ipc'
import { isUserMentioned } from '../../common/text/mentions'
import { dispatch, Dispatchable } from '../dispatch-registry'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in ChatEvent['action']]?: (
    channel: string,
    event: Extract<ChatEvent, { action: E }>,
  ) => Dispatchable
}

const eventToAction: EventToActionMap = {
  init(channel, event) {
    return {
      type: '@chat/initChannel',
      payload: {
        channel,
        activeUsers: event.activeUsers,
      },
    }
  },

  join(channel, event) {
    return {
      type: '@chat/updateJoin',
      payload: {
        channel,
        channelUser: event.channelUser,
        user: event.user,
        message: event.message,
      },
    }
  },

  leave: (channel, event) => (dispatch, getState) => {
    const { auth } = getState()
    if (auth.user.id === event.user.id) {
      // It was us who left the channel
      dispatch({
        type: '@chat/updateLeaveSelf',
        payload: {
          channel,
        },
      })
    } else {
      dispatch({
        type: '@chat/updateLeave',
        payload: {
          channel,
          user: event.user,
          newOwner: event.newOwner,
        },
      })
    }
  },

  message(channel, event) {
    return (dispatch, getState) => {
      const { auth } = getState()
      const isHighlighted =
        event.type === ServerChatMessageType.TextMessage &&
        isUserMentioned(auth.user.name, event.text)

      // Notify the main process of the new message, so it can display an appropriate notification
      ipcRenderer.send('chatNewMessage', {
        user: event.user.name,
        message: event.text,
        isHighlighted,
      })

      dispatch({
        type: '@chat/updateMessage',
        payload: {
          ...event,
          isHighlighted,
        },
      })
    }
  },

  userActive(channel, event) {
    return {
      type: '@chat/updateUserActive',
      payload: {
        channel,
        user: event.user,
      },
    }
  },

  userIdle(channel, event) {
    return {
      type: '@chat/updateUserIdle',
      payload: {
        channel,
        user: event.user,
      },
    }
  },

  userOffline(channel, event) {
    return {
      type: '@chat/updateUserOffline',
      payload: {
        channel,
        user: event.user,
      },
    }
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/chat2/:channel', (route, event) => {
    const actionName = event.action as ChatEvent['action']
    if (!eventToAction[actionName]) return

    const action = eventToAction[actionName]!(route.params.channel, event)
    if (action) dispatch(action)
  })
}
