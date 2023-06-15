import { NydusClient, RouteInfo } from 'nydus-client'
import { ChatEvent, ChatUserEvent, SbChannelId, makeSbChannelId } from '../../common/chat'
import { TypedIpcRenderer } from '../../common/ipc'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { Dispatchable, dispatch } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { TIMING_LONG, openSnackbar } from '../snackbars/action-creators'
import windowFocus from '../window-focus'

const ipcRenderer = new TypedIpcRenderer()

type EventToChatActionMap = {
  [E in ChatEvent['action']]: (
    channelId: SbChannelId,
    event: Extract<ChatEvent, { action: E }>,
  ) => Dispatchable | undefined
}

const eventToChatAction: EventToChatActionMap = {
  init3(channelId, event) {
    return {
      type: '@chat/initChannel',
      payload: event,
      meta: { channelId },
    }
  },

  join2(channelId, event) {
    return {
      type: '@chat/updateJoin',
      payload: event,
      meta: { channelId },
    }
  },

  leave2: (channelId, event) => (dispatch, getState) => {
    const { auth } = getState()
    if (auth.user.id === event.userId) {
      // It was us who left the channel
      dispatch({
        type: '@chat/updateLeaveSelf',
        meta: { channelId },
      })
    } else {
      dispatch({
        type: '@chat/updateLeave',
        payload: event,
        meta: { channelId },
      })
    }
  },

  kick: (channelId, event) => (dispatch, getState) => {
    const { auth } = getState()

    if (auth.user.id === event.targetId) {
      // It was us who has been kicked from the channel
      dispatch(
        openSnackbar({
          message: i18n.t('chat.events.kick', {
            defaultValue: 'You have been kicked from {{channelName}}.',
            channelName: event.channelName,
          }),
          time: TIMING_LONG,
        }),
      )
      dispatch({
        type: '@chat/updateKickSelf',
        meta: { channelId },
      })
    } else {
      dispatch({
        type: '@chat/updateKick',
        payload: event,
        meta: { channelId },
      })
    }
  },

  ban: (channelId, event) => (dispatch, getState) => {
    const { auth } = getState()

    if (auth.user.id === event.targetId) {
      // It was us who has been banned from the channel
      // TODO(2Pac): Send a notification to the banned user that they've been banned, instead of
      // just showing a snackbar which is easily missed if the user is not looking.
      dispatch(
        openSnackbar({
          message: i18n.t('chat.events.ban', {
            defaultValue: 'You have been banned from {{channelName}}.',
            channelName: event.channelName,
          }),
          time: TIMING_LONG,
        }),
      )
      dispatch({
        type: '@chat/updateBanSelf',
        meta: { channelId },
      })
    } else {
      dispatch({
        type: '@chat/updateBan',
        payload: event,
        meta: { channelId },
      })
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
      const isUrgent = !isBlocked && event.mentions.some(m => m.id === auth.user.id)
      if (!isBlocked) {
        // Notify the main process of the new message, so it can display an appropriate notification
        ipcRenderer.send('chatNewMessage', {
          urgent: isUrgent,
        })
      }

      dispatch({
        type: '@chat/updateMessage',
        payload: event,
        meta: { channelId },
      })

      const isChannelActivated = activatedChannels.has(channelId)
      if (isUrgent && (!isChannelActivated || !windowFocus.isFocused())) {
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
}

type EventToChatUserActionMap = {
  [E in ChatUserEvent['action']]: (
    channelId: SbChannelId,
    event: Extract<ChatUserEvent, { action: E }>,
  ) => Dispatchable | undefined
}

const eventToChatUserAction: EventToChatUserActionMap = {
  permissionsChanged(channelId, event) {
    return {
      type: '@chat/permissionsChanged',
      payload: event,
      meta: { channelId },
    }
  },
}

const CHANNEL_PATH = '/chat3/:channelId'

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute(CHANNEL_PATH, (route: RouteInfo, event: ChatEvent) => {
    if (!eventToChatAction.hasOwnProperty(event.action)) return

    const action = eventToChatAction[event.action](
      makeSbChannelId(Number(route.params.channelId)),
      event as any,
    )
    if (action) dispatch(action)
  })

  siteSocket.registerRoute(
    `${CHANNEL_PATH}/users/:userId`,
    (route: RouteInfo, event: ChatUserEvent) => {
      if (!eventToChatUserAction.hasOwnProperty(event.action)) return

      const action = eventToChatUserAction[event.action](
        makeSbChannelId(Number(route.params.channelId)),
        event as any,
      )
      if (action) dispatch(action)
    },
  )
}
