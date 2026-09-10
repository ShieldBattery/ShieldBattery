import type { NydusClient } from 'nydus-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ChannelNotificationLevel,
  type ChannelPreferences,
  type ChatMessageEvent,
  DEFAULT_CHANNEL_PREFERENCES,
  makeSbChannelId,
  ServerChatMessageType,
} from '../../common/chat'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { registerDispatch } from '../dispatch-registry'
import type { RootState } from '../root-reducer'
import registerModule from './socket-handlers'

const mocks = vi.hoisted(() => ({ send: vi.fn(), playSound: vi.fn() }))
vi.mock('../../common/ipc', () => ({
  TypedIpcRenderer: class {
    send = mocks.send
  },
}))
vi.mock('../audio/audio-manager', () => ({
  AvailableSound: { MessageAlert: 'message-alert' },
  audioManager: { playSound: mocks.playSound },
}))
vi.mock('../dom/window-focus', () => ({ default: { isFocused: () => false } }))

const CHANNEL_ID = makeSbChannelId(1)
const SELF = { id: makeSbUserId(1), name: 'self', created: 0 }
const OTHER = { id: makeSbUserId(2), name: 'other', created: 0 }

beforeEach(() => vi.clearAllMocks())

interface MessageCase {
  name: string
  fromSelf?: boolean
  blocked?: boolean
  mentionsSelf?: boolean
  /** Omitted to leave the channel without a preferences entry, exercising the defaults. */
  level?: ChannelNotificationLevel
  muted?: boolean
  /** Whether the message should be recorded as mentioning the current user. */
  mention: boolean
  /** Whether the message should alert: the attention IPC plus the alert sound. */
  alerts: boolean
  /** Whether an alert should ask for the urgent (taskbar-flashing) treatment. */
  urgent?: boolean
  /** Whether the reported game client status puts this client in a running game. */
  inGame?: boolean
  /** The account's `quietChannelsWhileInGame` setting. Defaults to `true`. */
  quietChannelsWhileInGame?: boolean
}

describe('channel message echoes', () => {
  test.each<MessageCase>([
    {
      name: 'a self message never alerts, even when it mentions self',
      fromSelf: true,
      mentionsSelf: true,
      level: ChannelNotificationLevel.All,
      mention: false,
      alerts: false,
    },
    {
      name: 'a blocked sender never alerts, even when they mention self',
      blocked: true,
      mentionsSelf: true,
      level: ChannelNotificationLevel.All,
      mention: false,
      alerts: false,
    },
    {
      name: 'mentions level alerts urgently for a mention',
      mentionsSelf: true,
      level: ChannelNotificationLevel.Mentions,
      mention: true,
      alerts: true,
      urgent: true,
    },
    {
      name: 'mentions level stays silent for a message that mentions no one',
      level: ChannelNotificationLevel.Mentions,
      mention: false,
      alerts: false,
    },
    {
      name: 'mentions level still alerts for a mention while muted',
      mentionsSelf: true,
      level: ChannelNotificationLevel.Mentions,
      muted: true,
      mention: true,
      alerts: true,
      urgent: true,
    },
    {
      name: 'mentions level stays silent for a non-mention while muted',
      level: ChannelNotificationLevel.Mentions,
      muted: true,
      mention: false,
      alerts: false,
    },
    {
      name: 'all level alerts non-urgently for a message that mentions no one',
      level: ChannelNotificationLevel.All,
      mention: false,
      alerts: true,
      urgent: false,
    },
    {
      name: 'all level alerts urgently for a mention',
      mentionsSelf: true,
      level: ChannelNotificationLevel.All,
      mention: true,
      alerts: true,
      urgent: true,
    },
    {
      name: 'all level muted stays silent for a message that mentions no one',
      level: ChannelNotificationLevel.All,
      muted: true,
      mention: false,
      alerts: false,
    },
    {
      name: 'all level muted still alerts urgently for a mention',
      mentionsSelf: true,
      level: ChannelNotificationLevel.All,
      muted: true,
      mention: true,
      alerts: true,
      urgent: true,
    },
    {
      name: 'nothing level stays silent for a mention',
      mentionsSelf: true,
      level: ChannelNotificationLevel.Nothing,
      mention: true,
      alerts: false,
    },
    {
      name: 'nothing level stays silent for a message that mentions no one',
      level: ChannelNotificationLevel.Nothing,
      mention: false,
      alerts: false,
    },
    {
      name: 'a channel with no stored preferences alerts urgently for a mention',
      mentionsSelf: true,
      mention: true,
      alerts: true,
      urgent: true,
    },
    {
      name: 'a channel with no stored preferences stays silent for a non-mention',
      mention: false,
      alerts: false,
    },
    {
      name: 'in a game with quiet on, a mention at the all level stays silent',
      inGame: true,
      mentionsSelf: true,
      level: ChannelNotificationLevel.All,
      mention: true,
      alerts: false,
    },
    {
      name: 'in a game with quiet on, a non-mention at the all level stays silent',
      inGame: true,
      level: ChannelNotificationLevel.All,
      mention: false,
      alerts: false,
    },
    {
      name: 'in a game with quiet on, a mention at the mentions level stays silent',
      inGame: true,
      mentionsSelf: true,
      level: ChannelNotificationLevel.Mentions,
      mention: true,
      alerts: false,
    },
    {
      name: 'in a game with quiet off, a mention alerts urgently',
      inGame: true,
      quietChannelsWhileInGame: false,
      mentionsSelf: true,
      level: ChannelNotificationLevel.Mentions,
      mention: true,
      alerts: true,
      urgent: true,
    },
    {
      name: 'in a game with quiet off, a non-mention at the all level alerts non-urgently',
      inGame: true,
      quietChannelsWhileInGame: false,
      level: ChannelNotificationLevel.All,
      mention: false,
      alerts: true,
      urgent: false,
    },
    {
      name: 'out of a game with quiet on, a mention alerts urgently',
      inGame: false,
      mentionsSelf: true,
      level: ChannelNotificationLevel.Mentions,
      mention: true,
      alerts: true,
      urgent: true,
    },
  ])('$name', options => {
    const sender = options.fromSelf ? SELF : OTHER
    const preferences: ChannelPreferences | undefined =
      options.level !== undefined
        ? {
            ...DEFAULT_CHANNEL_PREFERENCES,
            notificationLevel: options.level,
            muted: options.muted ?? false,
          }
        : undefined
    const state = {
      auth: { self: { user: SELF } },
      chat: {
        activatedChannels: new Set(),
        idToSelfPreferences: new Map(preferences ? [[CHANNEL_ID, preferences]] : []),
      },
      relationships: { blocks: new Map(options.blocked ? [[sender.id, {}]] : []) },
      settings: {
        account: {
          quietChannelsWhileInGame: options.quietChannelsWhileInGame ?? true,
          quietWhispersWhileInGame: true,
        },
      },
      gameClient: {
        gameId: options.inGame ? 'game-1' : undefined,
        status: options.inGame ? { id: 'game-1', state: 'playing', isReplay: false } : undefined,
      },
    } as unknown as RootState
    const dispatched = vi.fn()
    registerDispatch(action => {
      if (typeof action === 'function') {
        action(dispatched, () => state)
      } else {
        dispatched(action)
      }
    })
    const registerRoute = vi.fn()
    registerModule({ siteSocket: { registerRoute } as unknown as NydusClient })
    const [, receive] = registerRoute.mock.calls.find(([path]) => path === '/chat3/:channelId')!
    const event: ChatMessageEvent = {
      action: 'message2',
      message: {
        id: 'message-1',
        type: ServerChatMessageType.TextMessage,
        channelId: CHANNEL_ID,
        from: sender.id,
        time: 200,
        text: 'hello',
      },
      user: sender,
      mentions: options.mentionsSelf ? [SELF] : [],
      channelMentions: [],
    }
    receive({ params: { channelId: String(CHANNEL_ID) } }, event)

    expect(dispatched).toHaveBeenCalledExactlyOnceWith({
      type: '@chat/updateMessage',
      payload: event,
      meta: {
        channelId: CHANNEL_ID,
        isSelfMessage: options.fromSelf ?? false,
        mentionsSelf: options.mention,
        windowFocused: false,
      },
    })
    expect(mocks.send.mock.calls).toEqual(
      options.alerts ? [['chatNewMessage', { urgent: options.urgent }]] : [],
    )
    expect(mocks.playSound).toHaveBeenCalledTimes(options.alerts ? 1 : 0)
  })
})
