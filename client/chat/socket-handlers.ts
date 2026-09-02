import { NydusClient, RouteInfo } from 'nydus-client'
import { ChatEvent, ChatUserEvent, SbChannelId, makeSbChannelId } from '../../common/chat'
import { TypedIpcRenderer } from '../../common/ipc'
import { AvailableSound, audioManager } from '../audio/audio-manager'
import { Dispatchable, dispatch } from '../dispatch-registry'
import windowFocus from '../dom/window-focus'

const ipcRenderer = new TypedIpcRenderer()

type EventToChatActionMap = {
  [E in ChatEvent['action']]: (
    channelId: SbChannelId,
    event: Extract<ChatEvent, { action: E }>,
  ) => Dispatchable | undefined
}

const eventToChatAction: EventToChatActionMap = {
  join2(channelId, event) {
    return {
      type: '@chat/updateJoin',
      payload: event,
      meta: { channelId, windowFocused: windowFocus.isFocused() },
    }
  },

  edit: (channelId, event) => dispatch => {
    dispatch({
      type: '@chat/getChannelInfo',
      payload: event,
      meta: {
        channelId,
      },
    })
  },

  leave2: (channelId, event) => (dispatch, getState) => {
    const { auth } = getState()
    if (auth.self!.user.id === event.userId) {
      // It was us who left the channel
      dispatch({
        type: '@chat/updateLeaveSelf',
        meta: { channelId },
      })
    } else {
      dispatch({
        type: '@chat/updateLeave',
        payload: event,
        meta: { channelId, windowFocused: windowFocus.isFocused() },
      })
    }
  },

  kick: (channelId, event) => (dispatch, getState) => {
    const { auth } = getState()

    if (auth.self!.user.id === event.targetId) {
      // It was us who has been kicked from the channel
      dispatch({
        type: '@chat/updateKickSelf',
        meta: { channelId },
      })
    } else {
      dispatch({
        type: '@chat/updateKick',
        payload: event,
        meta: { channelId, windowFocused: windowFocus.isFocused() },
      })
    }
  },

  ban: (channelId, event) => (dispatch, getState) => {
    const { auth } = getState()

    if (auth.self!.user.id === event.targetId) {
      // It was us who has been banned from the channel
      dispatch({
        type: '@chat/updateBanSelf',
        meta: { channelId },
      })
    } else {
      dispatch({
        type: '@chat/updateBan',
        payload: event,
        meta: { channelId, windowFocused: windowFocus.isFocused() },
      })
    }
  },

  ownerChanged(channelId, event) {
    return {
      type: '@chat/ownerChanged',
      payload: event,
      meta: { channelId, windowFocused: windowFocus.isFocused() },
    }
  },

  message2(channelId, event) {
    return (dispatch, getState) => {
      const {
        auth,
        chat: { activatedChannels },
        relationships: { blocks },
      } = getState()

      const isBlocked = blocks.has(event.message.from)
      const isUrgent = !isBlocked && event.mentions.some(m => m.id === auth.self!.user.id)
      const windowFocused = windowFocus.isFocused()
      if (isUrgent) {
        // Mentions get the main process's transient attention treatment (urgent tray icon +
        // taskbar flash); regular messages reach it through the tracked unread state instead.
        ipcRenderer.send('chatNewMessage', {
          urgent: true,
        })
      }

      dispatch({
        type: '@chat/updateMessage',
        payload: event,
        meta: { channelId, mentionsSelf: isUrgent, windowFocused },
      })

      const isChannelActivated = activatedChannels.has(channelId)
      if (isUrgent && (!isChannelActivated || !windowFocused)) {
        audioManager.playSound(AvailableSound.MessageAlert)
      }
    }
  },

  messageDeleted(channelId, event) {
    return {
      type: '@chat/updateMessageDeleted',
      payload: event,
      meta: { channelId },
    }
  },

  initActiveUsers(channelId, event) {
    return {
      type: '@chat/initActiveUsers',
      payload: event,
      meta: { channelId },
    }
  },

  userActive2(channelId, event) {
    return {
      type: '@chat/updateUserActive',
      payload: event,
      meta: { channelId },
    }
  },

  userIdle2(channelId, event) {
    return {
      type: '@chat/updateUserIdle',
      payload: event,
      meta: { channelId },
    }
  },

  userOffline2(channelId, event) {
    return {
      type: '@chat/updateUserOffline',
      payload: event,
      meta: { channelId },
    }
  },

  userProfileChanged(channelId, event) {
    return {
      type: '@chat/userProfileChanged',
      payload: event,
      meta: { channelId },
    }
  },
}

type EventToChatUserActionMap = {
  [E in ChatUserEvent['action']]: (
    channelId: SbChannelId,
    event: Extract<ChatUserEvent, { action: E }>,
  ) => Dispatchable | undefined
}

const eventToChatUserAction: EventToChatUserActionMap = {
  init3(channelId, event) {
    return {
      type: '@chat/initChannel',
      payload: event,
      meta: { channelId },
    }
  },
  preferencesChanged(channelId, event) {
    return {
      type: '@chat/preferencesChanged',
      payload: event,
      meta: { channelId },
    }
  },
  permissionsChanged(channelId, event) {
    return {
      type: '@chat/permissionsChanged',
      payload: event,
      meta: { channelId },
    }
  },

  lastReadTimeChanged(channelId, event) {
    return {
      type: '@chat/updateLastReadTime',
      payload: { channelId, lastReadTime: event.lastReadTime },
    }
  },
}

const CHANNEL_PATH = '/chat3/:channelId'

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute(CHANNEL_PATH, (route: RouteInfo, event: ChatEvent) => {
    if (!Object.hasOwn(eventToChatAction, event.action)) return

    const action = eventToChatAction[event.action](
      makeSbChannelId(Number(route.params.channelId)),
      event as any,
    )
    if (action) dispatch(action)
  })

  siteSocket.registerRoute(
    `${CHANNEL_PATH}/users/:userId`,
    (route: RouteInfo, event: ChatUserEvent) => {
      if (!Object.hasOwn(eventToChatUserAction, event.action)) return

      const action = eventToChatUserAction[event.action](
        makeSbChannelId(Number(route.params.channelId)),
        event as any,
      )
      if (action) dispatch(action)
    },
  )
}
