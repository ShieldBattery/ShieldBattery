import type { NydusClient } from 'nydus-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../common/chat'
import { RolledOutcome } from '../../common/rolled-outcomes'
import { DEFAULT_ACCOUNT_SETTINGS } from '../../common/settings/account-settings'
import { UserAvailability } from '../../common/users/availability'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { type WhisperMessageEvent, WhisperMessageType } from '../../common/whispers'
import { registerDispatch } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import { lastChatSurfaceAtom, LocalMessageTarget } from '../messaging/local-message-target'
import { CommonMessageType } from '../messaging/message-records'
import type { RootState } from '../root-reducer'
import registerModule from './socket-handlers'
import { lastWhisperSenderAtom } from './whisper-atoms'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  playSound: vi.fn(),
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

const SELF = { id: makeSbUserId(1), name: 'self', created: 0 }
const OTHER = { id: makeSbUserId(2), name: 'other', created: 0 }
const CHANNEL_SURFACE: LocalMessageTarget = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
}

beforeEach(() => {
  vi.clearAllMocks()
  jotaiStore.set(lastWhisperSenderAtom, undefined)
  jotaiStore.set(lastChatSurfaceAtom, CHANNEL_SURFACE)
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
  /** The account's `availability`. Defaults to online. */
  availability?: UserAvailability
  /** Whether the message should alert: the attention IPC plus the alert sound. */
  alerts: boolean
  /** The surface last on screen, which is where an echo goes. Defaults to a chat channel. */
  surface?: LocalMessageTarget
  /** Whether the message should be echoed into `surface`. */
  echoed: boolean
  /** Whether the sender should become the `/reply` target (`lastWhisperSenderAtom`). */
  becomesReplyTarget: boolean
  /** Present and `true` to send the message as a `/me` action line. */
  emote?: boolean
  /** Present to send the message as a server-settled outcome. */
  outcome?: RolledOutcome
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
      name: 'in do not disturb, a message is recorded and echoed but does not alert',
      fromSelf: false,
      blocked: false,
      availability: UserAvailability.DoNotDisturb,
      alerts: false,
      echoed: true,
      becomesReplyTarget: true,
    },
    {
      name: 'while away, a message alerts as usual',
      fromSelf: false,
      blocked: false,
      availability: UserAvailability.Away,
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
    {
      name: 'a server-settled outcome carries the outcome into the echo',
      fromSelf: false,
      blocked: false,
      alerts: true,
      echoed: true,
      becomesReplyTarget: true,
      emote: true,
      outcome: { kind: 'roll', max: 100, value: 42 },
    },
    {
      name: 'with no surface seen yet, a message has nowhere to be echoed',
      fromSelf: false,
      blocked: false,
      surface: undefined,
      alerts: true,
      echoed: false,
      becomesReplyTarget: true,
    },
    {
      name: "the counterpart's own conversation already shows the message, so it is not echoed",
      fromSelf: false,
      blocked: false,
      surface: { surface: 'whisper', userId: OTHER.id },
      alerts: true,
      echoed: false,
      becomesReplyTarget: true,
    },
    {
      name: "another user's conversation is echoed into like any other surface",
      fromSelf: false,
      blocked: false,
      surface: { surface: 'whisper', userId: makeSbUserId(7) },
      alerts: true,
      echoed: true,
      becomesReplyTarget: true,
    },
  ])('$name', options => {
    const surface = Object.hasOwn(options, 'surface') ? options.surface : CHANNEL_SURFACE
    jotaiStore.set(lastChatSurfaceAtom, surface)

    const sender = options.fromSelf ? SELF : OTHER
    const state = {
      auth: { self: { user: SELF } },
      whispers: { byId: new Map([[OTHER.id, { activated: false }]]) },
      relationships: { blocks: new Map(options.blocked ? [[sender.id, {}]] : []) },
      settings: {
        account: {
          ...DEFAULT_ACCOUNT_SETTINGS,
          quietWhispersWhileInGame: options.quietWhispersWhileInGame ?? true,
          showWhispersEverywhere: options.showWhispersEverywhere ?? true,
          availability: options.availability ?? UserAvailability.Online,
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
        ...(options.outcome ? { outcome: options.outcome } : {}),
      },
      users: [SELF, OTHER],
      mentions: [],
      channelMentions: [],
    }
    receive({}, event)

    expect(dispatched).toHaveBeenNthCalledWith(1, {
      type: '@whispers/updateMessage',
      payload: event,
      meta: { target: OTHER.id, isSelfMessage: options.fromSelf, windowFocused: false },
    })
    expect(mocks.send).toHaveBeenCalledTimes(options.alerts ? 1 : 0)
    expect(mocks.playSound).toHaveBeenCalledTimes(options.alerts ? 1 : 0)

    const echoDispatches = dispatched.mock.calls
      .map(([action]) => action)
      .filter(action => action.type === '@messaging/appendLocalMessage')
    // The echoed line carries the server-recorded time of the whisper, so it sorts among the
    // messages it lands beside and shows when the whisper was actually sent.
    const expectedEcho = {
      type: '@messaging/appendLocalMessage',
      payload: {
        target: surface,
        message: {
          id: expect.any(String),
          type: CommonMessageType.WhisperEcho,
          time: 200,
          direction: options.fromSelf ? 'outgoing' : 'incoming',
          counterpartId: OTHER.id,
          text: 'hello',
          ...(options.emote ? { emote: true } : {}),
          ...(options.outcome ? { outcome: options.outcome } : {}),
        },
      },
    }
    expect(echoDispatches).toEqual(options.echoed ? [expectedEcho] : [])

    expect(jotaiStore.get(lastWhisperSenderAtom)).toBe(
      options.becomesReplyTarget ? sender.id : undefined,
    )
  })
})
