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

interface WhisperCase {
  name: string
  fromSelf: boolean
  blocked: boolean
  /** Whether the reported game client status puts this client in a running game. */
  inGame?: boolean
  /** The account's `quietWhispersWhileInGame` setting. Defaults to `true`. */
  quietWhispersWhileInGame?: boolean
  /** Whether the message should alert: the attention IPC plus the alert sound. */
  alerts: boolean
}

describe('whisper message echoes', () => {
  test.each<WhisperCase>([
    { name: 'classifies true self / false blocked', fromSelf: true, blocked: false, alerts: false },
    {
      name: 'classifies false self / false blocked',
      fromSelf: false,
      blocked: false,
      alerts: true,
    },
    { name: 'classifies false self / true blocked', fromSelf: false, blocked: true, alerts: false },
    {
      name: 'in a game with whisper quiet on, a message records unread but does not alert',
      fromSelf: false,
      blocked: false,
      inGame: true,
      alerts: false,
    },
    {
      name: 'in a game with whisper quiet off, a message alerts',
      fromSelf: false,
      blocked: false,
      inGame: true,
      quietWhispersWhileInGame: false,
      alerts: true,
    },
    {
      name: 'out of a game with whisper quiet on, a message alerts as before',
      fromSelf: false,
      blocked: false,
      inGame: false,
      alerts: true,
    },
  ])('$name', options => {
    const sender = options.fromSelf ? SELF : OTHER
    const state = {
      auth: { self: { user: SELF } },
      whispers: { byId: new Map([[OTHER.id, { activated: false }]]) },
      relationships: { blocks: new Map(options.blocked ? [[sender.id, {}]] : []) },
      settings: {
        account: {
          quietChannelsWhileInGame: true,
          quietWhispersWhileInGame: options.quietWhispersWhileInGame ?? true,
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
