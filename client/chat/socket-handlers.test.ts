import type { NydusClient } from 'nydus-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { type ChatMessageEvent, makeSbChannelId, ServerChatMessageType } from '../../common/chat'
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

describe('channel message echoes', () => {
  test.each([
    { fromSelf: true, blocked: false, mentionsSelf: true, alerts: false },
    { fromSelf: false, blocked: false, mentionsSelf: true, alerts: true },
    { fromSelf: false, blocked: false, mentionsSelf: false, alerts: false },
    { fromSelf: false, blocked: true, mentionsSelf: true, alerts: false },
  ])('classifies $fromSelf self / $blocked blocked / $mentionsSelf mention', options => {
    const sender = options.fromSelf ? SELF : OTHER
    const state = {
      auth: { self: { user: SELF } },
      chat: { activatedChannels: new Set() },
      relationships: { blocks: new Map(options.blocked ? [[sender.id, {}]] : []) },
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
        isSelfMessage: options.fromSelf,
        mentionsSelf: options.alerts,
        windowFocused: false,
      },
    })
    expect(mocks.send).toHaveBeenCalledTimes(options.alerts ? 1 : 0)
    expect(mocks.playSound).toHaveBeenCalledTimes(options.alerts ? 1 : 0)
  })
})
