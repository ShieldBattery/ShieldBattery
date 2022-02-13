import { NydusClient } from 'nydus-client'
import { ChatEvent, ChatUserEvent } from '../../common/chat'
import { TypedIpcRenderer } from '../../common/ipc'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { dispatch, Dispatchable } from '../dispatch-registry'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import windowFocus from '../window-focus'

const ipcRenderer = new TypedIpcRenderer()

type EventToChatActionMap = {
  [E in ChatEvent['action']]: (
    channel: string,
    event: Extract<ChatEvent, { action: E }>,
  ) => Dispatchable | undefined
}

const eventToChatAction: EventToChatActionMap = {
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

  kick: (channel, event) => (dispatch, getState) => {
    const { auth } = getState()
    if (auth.user.id === event.targetId) {
      // It was us who has been kicked from the channel
      dispatch(
        openSnackbar({ message: `You have been kicked from ${channel}.`, time: TIMING_LONG }),
      )
      dispatch({
        type: '@chat/updateKickSelf',
        meta: { channel },
      })
    } else {
      dispatch({
        type: '@chat/updateKick',
        payload: event,
        meta: { channel },
      })
    }
  },

  ban: (channel, event) => (dispatch, getState) => {
    const { auth } = getState()
    if (auth.user.id === event.targetId) {
      // It was us who has been banned from the channel
      // TODO(2Pac): Send a notification to the banned user that they've been banned, instead of
      // just showing a snackbar which is easily missed if the user is not looking.
      dispatch(
        openSnackbar({ message: `You have been banned from ${channel}.`, time: TIMING_LONG }),
      )
      dispatch({
        type: '@chat/updateBanSelf',
        meta: { channel },
      })
    } else {
      dispatch({
        type: '@chat/updateBan',
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
}

type EventToChatUserActionMap = {
  [E in ChatUserEvent['action']]: (
    channel: string,
    event: Extract<ChatUserEvent, { action: E }>,
  ) => Dispatchable | undefined
}

const eventToChatUserAction: EventToChatUserActionMap = {
  permissionsChanged(channel, event) {
    return {
      type: '@chat/permissionsChanged',
      payload: event,
      meta: { channel },
    }
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/chat2/:channel', (route, event) => {
    const actionName = event.action as ChatEvent['action']
    if (!eventToChatAction[actionName]) return

    const action = eventToChatAction[actionName](route.params.channel, event)
    if (action) dispatch(action)
  })

  siteSocket.registerRoute('/chat/:channel/users/:userId', (route, event) => {
    const actionName = event.action as ChatUserEvent['action']
    if (!eventToChatUserAction[actionName]) return

    const action = eventToChatUserAction[actionName](route.params.channel, event)
    if (action) dispatch(action)
  })
}
