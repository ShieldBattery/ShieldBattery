import type { NydusClient } from 'nydus-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LobbyChatEvent } from '../../common/lobbies/lobby-network'
import { DEFAULT_ACCOUNT_SETTINGS } from '../../common/settings/account-settings'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { registerDispatch } from '../dispatch-registry'
import type { RootState } from '../root-reducer'
import registerModule from './electron-socket-handlers'

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

beforeEach(() => {
  vi.clearAllMocks()
})

interface LobbyChatCase {
  name: string
  blocked?: boolean
  /** Whether the reported game client status puts this client in a running game. */
  inGame?: boolean
  /** The account's `quietLobbyWhileInGame` setting. Defaults to `true`. */
  quietLobbyWhileInGame?: boolean
  /** The account's `playMessageSounds` setting. Defaults to `true`. */
  playMessageSounds?: boolean
  /** Whether the message should alert: the attention IPC plus the alert sound. */
  alerts: boolean
  /** Whether an alert should play the alert sound. Defaults to `alerts`. */
  sound?: boolean
}

describe('lobby chat alerts', () => {
  test.each<LobbyChatCase>([
    {
      name: 'out of a game, a message alerts',
      alerts: true,
    },
    {
      name: 'a blocked sender does not alert',
      blocked: true,
      alerts: false,
    },
    {
      name: 'in a game with lobby quiet on, a message is recorded but does not alert',
      inGame: true,
      alerts: false,
    },
    {
      name: 'in a game with lobby quiet off, a message alerts',
      inGame: true,
      quietLobbyWhileInGame: false,
      alerts: true,
    },
    {
      name: 'with message sounds off, a message still asks for attention without a sound',
      playMessageSounds: false,
      alerts: true,
      sound: false,
    },
  ])('$name', options => {
    const state = {
      auth: { self: { user: SELF } },
      lobby: { activated: false },
      relationships: { blocks: new Map(options.blocked ? [[OTHER.id, {}]] : []) },
      settings: {
        account: {
          ...DEFAULT_ACCOUNT_SETTINGS,
          quietLobbyWhileInGame: options.quietLobbyWhileInGame ?? true,
          playMessageSounds: options.playMessageSounds ?? true,
        },
      },
      gameClient: {
        gameId: options.inGame ? 'game-1' : undefined,
        status: options.inGame ? { id: 'game-1', state: 'playing', isReplay: false } : undefined,
        watchOnly: {},
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
    const [, receive] = registerRoute.mock.calls.find(([path]) => path === '/lobbies/:lobbyId')!
    const event: LobbyChatEvent = {
      type: 'chat',
      message: { lobbyName: 'lobby', time: 200, from: OTHER.id, text: 'hello' },
      mentions: [],
      channelMentions: [],
    }
    receive({ params: { lobbyId: 'lobby-1' } }, event)

    expect(dispatched).toHaveBeenCalledWith({ type: '@lobbies/updateChatMessage', payload: event })
    expect(mocks.send.mock.calls).toEqual(
      options.alerts ? [['chatNewMessage', { urgent: false, flashTaskbar: true }]] : [],
    )
    expect(mocks.playSound).toHaveBeenCalledTimes((options.sound ?? options.alerts) ? 1 : 0)
  })
})
