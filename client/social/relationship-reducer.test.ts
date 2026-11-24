import { Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { FriendActivityStatus, UserRelationshipKind } from '../../common/users/relationships'
import { makeSbUserId } from '../../common/users/sb-user-id'
import relationshipReducerImport, { RelationshipState } from './relationship-reducer'

// `immerKeyedReducer` accepts any action with a string `type`; these tests feed it plain objects
// shaped like the dispatched actions (including the `system` field the store adds).
const relationshipReducer = relationshipReducerImport as unknown as (
  state: Immutable<RelationshipState> | undefined,
  action: { type: string; [key: string]: unknown },
) => Immutable<RelationshipState>

const INITIAL = relationshipReducer(undefined, { type: '@@init' })

const LOADED_ACTION = {
  type: '@users/getRelationships',
  payload: {
    summary: { friends: [], blocks: [], incomingRequests: [], outgoingRequests: [] },
    users: [],
  },
  system: { monotonicTime: 1000 },
}

const FAILURE_ACTION = { type: '@users/getRelationshipsFailure' }

describe('client/social/relationship-reducer', () => {
  test('a failed load sets loadError', () => {
    const state = relationshipReducer(INITIAL, FAILURE_ACTION)
    expect(state.loadError).toBe(true)
    expect(state.loaded).toBe(false)
  })

  test('a successful load clears loadError', () => {
    let state = relationshipReducer(INITIAL, FAILURE_ACTION)
    state = relationshipReducer(state, LOADED_ACTION)
    expect(state.loadError).toBe(false)
    expect(state.loaded).toBe(true)
  })

  test('a failure after another request already loaded them leaves loadError unset', () => {
    let state = relationshipReducer(INITIAL, LOADED_ACTION)
    state = relationshipReducer(state, FAILURE_ACTION)
    expect(state.loadError).toBe(false)
  })

  test('reconnecting clears loadError', () => {
    let state = relationshipReducer(INITIAL, FAILURE_ACTION)
    state = relationshipReducer(state, { type: '@network/connect' })
    expect(state.loadError).toBe(false)
  })

  describe('friend activity lobby', () => {
    const FRIEND = makeSbUserId(7)
    const LOBBY = { id: makeSbLobbyId('lobby-1'), name: 'Fun times' }
    const friendRelationship = {
      fromId: makeSbUserId(1),
      toId: FRIEND,
      kind: UserRelationshipKind.Friend,
      createdAt: 0,
    }

    function inLobby() {
      return relationshipReducer(INITIAL, {
        type: '@users/updateFriendActivityStatus',
        payload: { userId: FRIEND, status: FriendActivityStatus.InLobby, lobby: LOBBY },
      })
    }

    test('an InLobby update with a lobby stores it', () => {
      const state = inLobby()
      expect(state.friendActivityStatus.get(FRIEND)).toBe(FriendActivityStatus.InLobby)
      expect(state.friendActivityLobby.get(FRIEND)).toEqual(LOBBY)
    })

    test('an InLobby update without a lobby stores none', () => {
      const state = relationshipReducer(INITIAL, {
        type: '@users/updateFriendActivityStatus',
        payload: { userId: FRIEND, status: FriendActivityStatus.InLobby },
      })
      expect(state.friendActivityLobby.has(FRIEND)).toBe(false)
    })

    test('any other status clears the stored lobby', () => {
      for (const status of [
        FriendActivityStatus.InGame,
        FriendActivityStatus.InQueue,
        FriendActivityStatus.Online,
        FriendActivityStatus.Offline,
      ]) {
        const state = relationshipReducer(inLobby(), {
          type: '@users/updateFriendActivityStatus',
          payload: { userId: FRIEND, status },
        })
        expect(state.friendActivityLobby.has(FRIEND)).toBe(false)
      }
    })

    test('a lobby update replaces the previous lobby', () => {
      const other = { id: makeSbLobbyId('lobby-2'), name: 'Other' }
      const state = relationshipReducer(inLobby(), {
        type: '@users/updateFriendActivityStatus',
        payload: { userId: FRIEND, status: FriendActivityStatus.InLobby, lobby: other },
      })
      expect(state.friendActivityLobby.get(FRIEND)).toEqual(other)
    })

    test('deleting the relationship drops the lobby', () => {
      const state = relationshipReducer(inLobby(), {
        type: '@users/deleteRelationship',
        payload: { targetUser: FRIEND },
      })
      expect(state.friendActivityLobby.has(FRIEND)).toBe(false)
    })

    test('blocking the user drops the lobby', () => {
      const state = relationshipReducer(inLobby(), {
        type: '@users/upsertRelationship',
        payload: { relationship: { ...friendRelationship, kind: UserRelationshipKind.Block } },
        meta: { selfId: makeSbUserId(1) },
      })
      expect(state.friendActivityLobby.has(FRIEND)).toBe(false)
    })

    test('reloading relationships keeps lobbies of remaining friends only', () => {
      const other = makeSbUserId(8)
      let state = inLobby()
      state = relationshipReducer(state, {
        type: '@users/updateFriendActivityStatus',
        payload: { userId: other, status: FriendActivityStatus.InLobby, lobby: LOBBY },
      })
      state = relationshipReducer(state, {
        ...LOADED_ACTION,
        payload: {
          ...LOADED_ACTION.payload,
          summary: { ...LOADED_ACTION.payload.summary, friends: [friendRelationship] },
        },
      })
      expect(state.friendActivityLobby.get(FRIEND)).toEqual(LOBBY)
      expect(state.friendActivityLobby.has(other)).toBe(false)
    })

    test('reconnecting clears lobbies', () => {
      const state = relationshipReducer(inLobby(), { type: '@network/connect' })
      expect(state.friendActivityLobby.size).toBe(0)
    })
  })
})
