import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { LobbyPlayerRttStore } from './lobby-player-rtt-store'

const USER_A = makeSbUserId(1)
const USER_B = makeSbUserId(2)

describe('wsapi/lobby-player-rtt-store/LobbyPlayerRttStore', () => {
  test('returns an empty map for a lobby with no recorded rtt', () => {
    const store = new LobbyPlayerRttStore()
    expect(store.getAll('lobby-1')).toEqual(new Map())
  })

  test('records and retrieves a single player rtt', () => {
    const store = new LobbyPlayerRttStore()
    store.set('lobby-1', USER_A, 42)
    expect(store.getAll('lobby-1')).toEqual(new Map([[USER_A, 42]]))
  })

  test('overwrites a previous value for the same lobby and user', () => {
    const store = new LobbyPlayerRttStore()
    store.set('lobby-1', USER_A, 42)
    store.set('lobby-1', USER_A, 99)
    expect(store.getAll('lobby-1')).toEqual(new Map([[USER_A, 99]]))
  })

  test('keeps separate lobbies and separate users independent', () => {
    const store = new LobbyPlayerRttStore()
    store.set('lobby-1', USER_A, 10)
    store.set('lobby-1', USER_B, 20)
    store.set('lobby-2', USER_A, 30)

    expect(store.getAll('lobby-1')).toEqual(
      new Map([
        [USER_A, 10],
        [USER_B, 20],
      ]),
    )
    expect(store.getAll('lobby-2')).toEqual(new Map([[USER_A, 30]]))
  })

  test('deleteUser drops only that user, leaving the rest of the lobby intact', () => {
    const store = new LobbyPlayerRttStore()
    store.set('lobby-1', USER_A, 10)
    store.set('lobby-1', USER_B, 20)

    store.deleteUser('lobby-1', USER_A)

    expect(store.getAll('lobby-1')).toEqual(new Map([[USER_B, 20]]))
  })

  test('deleteUser on an unknown lobby or user is a no-op, not a throw', () => {
    const store = new LobbyPlayerRttStore()
    expect(() => store.deleteUser('nonexistent', USER_A)).not.toThrow()

    store.set('lobby-1', USER_A, 10)
    expect(() => store.deleteUser('lobby-1', USER_B)).not.toThrow()
    expect(store.getAll('lobby-1')).toEqual(new Map([[USER_A, 10]]))
  })

  test('deleteLobby drops every recorded rtt for that lobby only', () => {
    const store = new LobbyPlayerRttStore()
    store.set('lobby-1', USER_A, 10)
    store.set('lobby-2', USER_A, 30)

    store.deleteLobby('lobby-1')

    expect(store.getAll('lobby-1')).toEqual(new Map())
    expect(store.getAll('lobby-2')).toEqual(new Map([[USER_A, 30]]))
  })

  test('a lobby re-created after deletion starts with no recorded rtt', () => {
    const store = new LobbyPlayerRttStore()
    store.set('lobby-1', USER_A, 10)
    store.deleteLobby('lobby-1')

    store.set('lobby-1', USER_B, 20)

    expect(store.getAll('lobby-1')).toEqual(new Map([[USER_B, 20]]))
  })
})
