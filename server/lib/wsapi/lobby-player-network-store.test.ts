import { describe, expect, test } from 'vitest'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { LobbyPlayerNetworkStore } from './lobby-player-network-store'

const USER_A = makeSbUserId(1)
const USER_B = makeSbUserId(2)

const LOBBY_1 = makeSbLobbyId('lobby-1')
const LOBBY_2 = makeSbLobbyId('lobby-2')

const PUBKEY_A = Buffer.alloc(32, 1).toString('base64')
const PUBKEY_B = Buffer.alloc(32, 2).toString('base64')

describe('wsapi/lobby-player-network-store/LobbyPlayerNetworkStore', () => {
  test('returns an empty map for a lobby with no recorded info', () => {
    const store = new LobbyPlayerNetworkStore()
    expect(store.getAll(LOBBY_1)).toEqual(new Map())
  })

  test('records and retrieves a single player rtt + pubkey', () => {
    const store = new LobbyPlayerNetworkStore()
    store.set(LOBBY_1, USER_A, { rttMs: 42, netcodeV2Pubkey: PUBKEY_A })
    expect(store.getAll(LOBBY_1)).toEqual(
      new Map([[USER_A, { rttMs: 42, netcodeV2Pubkey: PUBKEY_A }]]),
    )
  })

  test('records an rtt-only or pubkey-only entry', () => {
    const store = new LobbyPlayerNetworkStore()
    store.set(LOBBY_1, USER_A, { rttMs: 42 })
    store.set(LOBBY_1, USER_B, { netcodeV2Pubkey: PUBKEY_B })
    expect(store.getAll(LOBBY_1)).toEqual(
      new Map([
        [USER_A, { rttMs: 42 }],
        [USER_B, { netcodeV2Pubkey: PUBKEY_B }],
      ]),
    )
  })

  test('overwrites a previous value for the same lobby and user', () => {
    const store = new LobbyPlayerNetworkStore()
    store.set(LOBBY_1, USER_A, { rttMs: 42, netcodeV2Pubkey: PUBKEY_A })
    store.set(LOBBY_1, USER_A, { rttMs: 99, netcodeV2Pubkey: PUBKEY_B })
    expect(store.getAll(LOBBY_1)).toEqual(
      new Map([[USER_A, { rttMs: 99, netcodeV2Pubkey: PUBKEY_B }]]),
    )
  })

  test('keeps separate lobbies and separate users independent', () => {
    const store = new LobbyPlayerNetworkStore()
    store.set(LOBBY_1, USER_A, { rttMs: 10, netcodeV2Pubkey: PUBKEY_A })
    store.set(LOBBY_1, USER_B, { rttMs: 20, netcodeV2Pubkey: PUBKEY_B })
    store.set(LOBBY_2, USER_A, { rttMs: 30 })

    expect(store.getAll(LOBBY_1)).toEqual(
      new Map([
        [USER_A, { rttMs: 10, netcodeV2Pubkey: PUBKEY_A }],
        [USER_B, { rttMs: 20, netcodeV2Pubkey: PUBKEY_B }],
      ]),
    )
    expect(store.getAll(LOBBY_2)).toEqual(new Map([[USER_A, { rttMs: 30 }]]))
  })

  test('deleteUser drops only that user, leaving the rest of the lobby intact', () => {
    const store = new LobbyPlayerNetworkStore()
    store.set(LOBBY_1, USER_A, { rttMs: 10, netcodeV2Pubkey: PUBKEY_A })
    store.set(LOBBY_1, USER_B, { rttMs: 20, netcodeV2Pubkey: PUBKEY_B })

    store.deleteUser(LOBBY_1, USER_A)

    expect(store.getAll(LOBBY_1)).toEqual(
      new Map([[USER_B, { rttMs: 20, netcodeV2Pubkey: PUBKEY_B }]]),
    )
  })

  test('deleteUser on an unknown lobby or user is a no-op, not a throw', () => {
    const store = new LobbyPlayerNetworkStore()
    expect(() => store.deleteUser(makeSbLobbyId('nonexistent'), USER_A)).not.toThrow()

    store.set(LOBBY_1, USER_A, { rttMs: 10 })
    expect(() => store.deleteUser(LOBBY_1, USER_B)).not.toThrow()
    expect(store.getAll(LOBBY_1)).toEqual(new Map([[USER_A, { rttMs: 10 }]]))
  })

  test('deleteLobby drops every recorded entry for that lobby only', () => {
    const store = new LobbyPlayerNetworkStore()
    store.set(LOBBY_1, USER_A, { rttMs: 10, netcodeV2Pubkey: PUBKEY_A })
    store.set(LOBBY_2, USER_A, { rttMs: 30 })

    store.deleteLobby(LOBBY_1)

    expect(store.getAll(LOBBY_1)).toEqual(new Map())
    expect(store.getAll(LOBBY_2)).toEqual(new Map([[USER_A, { rttMs: 30 }]]))
  })

  test('a lobby re-created after deletion starts with no recorded info', () => {
    const store = new LobbyPlayerNetworkStore()
    store.set(LOBBY_1, USER_A, { rttMs: 10, netcodeV2Pubkey: PUBKEY_A })
    store.deleteLobby(LOBBY_1)

    store.set(LOBBY_1, USER_B, { rttMs: 20, netcodeV2Pubkey: PUBKEY_B })

    expect(store.getAll(LOBBY_1)).toEqual(
      new Map([[USER_B, { rttMs: 20, netcodeV2Pubkey: PUBKEY_B }]]),
    )
  })
})
