import type { NydusClient } from 'nydus-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { type WhisperMessageEvent, WhisperMessageType } from '../../common/whispers'
import { registerDispatch } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import type { RootState } from '../root-reducer'
import registerModule from './socket-handlers'
import { lastWhisperSenderAtom } from './whisper-atoms'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  playSound: vi.fn(),
  publishWhisperEcho: vi.fn(),
}))
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
vi.mock('./whisper-echo', () => ({ publishWhisperEcho: mocks.publishWhisperEcho }))

const SELF = { id: makeSbUserId(1), name: 'self', created: 0 }
const OTHER = { id: makeSbUserId(2), name: 'other', created: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  jotaiStore.set(lastWhisperSenderAtom, undefined)
})

interface WhisperCase {
  name: string
  fromSelf: boolean
  blocked: boolean
  /** Whether the reported game client status puts this client in a running game. */
  inGame?: boolean
  /** The account's `quietWhispersWhileInGame` setting. Defaults to `true`. */
  quietWhispersWhileInGame?: boolean
  /** The account's `showWhispersEverywhere` setting. Defaults to `true`. */
  showWhispersEverywhere?: boolean
  /** Whether the message should alert: the attention IPC plus the alert sound. */
  alerts: boolean
  /** Whether the message should publish a whisper echo. */
  echoed: boolean
  /** Whether the sender should become the `/reply` target (`lastWhisperSenderAtom`). */
  becomesReplyTarget: boolean
  /** Present and `true` to send the message as a `/me` action line. */
  emote?: boolean
}

describe('whisper message echoes', () => {
  test.each<WhisperCase>([
    {
      name: 'an outgoing message is echoed but does not become the reply target',
      fromSelf: true,
      blocked: false,
      alerts: false,
      echoed: true,
      becomesReplyTarget: false,
    },
    {
      name: 'an incoming message is echoed and becomes the reply target',
      fromSelf: false,
      blocked: false,
      alerts: true,
      echoed: true,
      becomesReplyTarget: true,
    },
    {
      name: 'a blocked sender is silent everywhere: no alert, no echo, no reply target',
      fromSelf: false,
      blocked: true,
      alerts: false,
      echoed: false,
      becomesReplyTarget: false,
    },
    {
      name: 'in a game with whisper quiet on, a message records unread and echoes but does not alert',
      fromSelf: false,
      blocked: false,
      inGame: true,
      alerts: false,
      echoed: true,
      becomesReplyTarget: true,
    },
    {
      name: 'in a game with whisper quiet off, a message alerts',
      fromSelf: false,
      blocked: false,
      inGame: true,
      quietWhispersWhileInGame: false,
      alerts: true,
      echoed: true,
      becomesReplyTarget: true,
    },
    {
      name: 'out of a game with whisper quiet on, a message alerts as before',
      fromSelf: false,
      blocked: false,
      inGame: false,
      alerts: true,
      echoed: true,
      becomesReplyTarget: true,
    },
    {
      name: 'with the setting off, a message still becomes the reply target but is not echoed',
      fromSelf: false,
      blocked: false,
      showWhispersEverywhere: false,
      alerts: true,
      echoed: false,
      becomesReplyTarget: true,
    },
    {
      name: 'an emote message carries emote: true in the echo',
      fromSelf: false,
      blocked: false,
      alerts: true,
      echoed: true,
      becomesReplyTarget: true,
      emote: true,
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
          showWhispersEverywhere: options.showWhispersEverywhere ?? true,
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
        ...(options.emote ? { emote: true } : {}),
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

    const expectedEchoCalls = options.echoed
      ? [
          [
            {
              messageId: 'message-1',
              time: 200,
              direction: options.fromSelf ? 'outgoing' : 'incoming',
              counterpartId: OTHER.id,
              text: 'hello',
              ...(options.emote ? { emote: true } : {}),
            },
          ],
        ]
      : []
    expect(mocks.publishWhisperEcho.mock.calls).toEqual(expectedEchoCalls)

    expect(jotaiStore.get(lastWhisperSenderAtom)).toBe(
      options.becomesReplyTarget ? sender.id : undefined,
    )
  })
})
