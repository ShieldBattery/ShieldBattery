import { NydusClient } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
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
import { dispatch, Dispatchable } from '../dispatch-registry'

const ipcRenderer = new TypedIpcRenderer()

// TODO(tec27): Put this in a common place and use it to restrict what the server can send as well
type ChatEvent =
  | ChatInitEvent
  | ChatJoinEvent
  | ChatLeaveEvent
  | ChatMessageEvent
  | ChatUserActiveEvent
  | ChatUserIdleEvent
  | ChatUserOfflineEvent

interface ChatInitEvent {
  action: 'init'
  activeUsers: string[]
}

interface ChatJoinEvent {
  action: 'join'
  user: string
}

interface ChatLeaveEvent {
  action: 'leave'
  user: string
  newOwner?: string
}

interface ChatMessageEvent {
  action: 'message'
  id: string
  sent: number
  user: string
  data: {
    text: string
  }
}

interface ChatUserActiveEvent {
  action: 'userActive'
  user: string
}

interface ChatUserIdleEvent {
  action: 'userIdle'
  user: string
}

interface ChatUserOfflineEvent {
  action: 'userOffline'
  user: string
}

type EventToActionMap = {
  [E in ChatEvent['action']]?: (
    channel: string,
    event: Extract<ChatEvent, { action: E }>,
  ) => Dispatchable
}

const eventToAction: EventToActionMap = {
  init(channel, event) {
    return {
      type: CHAT_INIT_CHANNEL,
      payload: {
        channel,
        activeUsers: event.activeUsers,
      },
    } as any
  },

  join(channel, event) {
    return {
      type: CHAT_UPDATE_JOIN,
      payload: {
        channel,
        user: event.user,
      },
    } as any
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
      } as any)
    } else {
      dispatch({
        type: CHAT_UPDATE_LEAVE,
        payload: {
          channel,
          user: event.user,
          newOwner: event.newOwner,
        },
      } as any)
    }
  },

  message(channel, event) {
    // Notify the main process of the new message, so it can display an appropriate notification
    ipcRenderer.send('chatNewMessage', { user: event.user, message: event.data.text })

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
    } as any
  },

  userActive(channel, event) {
    return {
      type: CHAT_UPDATE_USER_ACTIVE,
      payload: {
        channel,
        user: event.user,
      },
    } as any
  },

  userIdle(channel, event) {
    return {
      type: CHAT_UPDATE_USER_IDLE,
      payload: {
        channel,
        user: event.user,
      },
    } as any
  },

  userOffline(channel, event) {
    return {
      type: CHAT_UPDATE_USER_OFFLINE,
      payload: {
        channel,
        user: event.user,
      },
    } as any
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/chat/:channel', (route, event) => {
    const actionName = event.action as ChatEvent['action']
    if (!eventToAction[actionName]) return

    const action = eventToAction[actionName]!(route.params.channel, event)
    if (action) dispatch(action)
  })
}
