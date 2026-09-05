import type { NydusClient } from 'nydus-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { type WhisperMessageEvent, WhisperMessageType } from '../../common/whispers'
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

const SELF = { id: makeSbUserId(1), name: 'self', created: 0 }
const OTHER = { id: makeSbUserId(2), name: 'other', created: 0 }

beforeEach(() => vi.clearAllMocks())

describe('whisper message echoes', () => {
  test.each([
    { fromSelf: true, blocked: false, alerts: false },
    { fromSelf: false, blocked: false, alerts: true },
    { fromSelf: false, blocked: true, alerts: false },
  ])('classifies $fromSelf self / $blocked blocked', options => {
    const sender = options.fromSelf ? SELF : OTHER
    const state = {
      auth: { self: { user: SELF } },
      whispers: { byId: new Map([[OTHER.id, { activated: false }]]) },
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
    const [, receive] = registerRoute.mock.calls.find(
      ([path]) => path === '/whispers3/:userAndTarget',
    )!
    const event: WhisperMessageEvent = {
      action: 'message',
      message: {
        id: 'message-1',
        type: WhisperMessageType.TextMessage,
        from: sender.id,
        to: options.fromSelf ? OTHER.id : SELF.id,
        time: 200,
        text: 'hello',
      },
      users: [SELF, OTHER],
      mentions: [],
      channelMentions: [],
    }
    receive({}, event)

    expect(dispatched).toHaveBeenCalledExactlyOnceWith({
      type: '@whispers/updateMessage',
      payload: event,
      meta: { target: OTHER.id, isSelfMessage: options.fromSelf, windowFocused: false },
    })
    expect(mocks.send).toHaveBeenCalledTimes(options.alerts ? 1 : 0)
    expect(mocks.playSound).toHaveBeenCalledTimes(options.alerts ? 1 : 0)
  })
})
