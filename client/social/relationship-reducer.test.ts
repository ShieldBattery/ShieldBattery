import { Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
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
})
