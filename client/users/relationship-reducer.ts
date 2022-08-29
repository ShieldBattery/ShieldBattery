import { Immutable } from 'immer'
import { assertUnreachable } from '../../common/assert-unreachable'
import { UserRelationshipJson, UserRelationshipKind } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user'
import { NETWORK_SITE_CONNECTED } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface RelationshipState {
  friends: Map<SbUserId, UserRelationshipJson>
  blocks: Map<SbUserId, UserRelationshipJson>
  incomingRequests: Map<SbUserId, UserRelationshipJson>
  outgoingRequests: Map<SbUserId, UserRelationshipJson>
  loaded: boolean
  loadedAt: number
}

const DEFAULT_STATE: Immutable<RelationshipState> = {
  friends: new Map(),
  blocks: new Map(),
  incomingRequests: new Map(),
  outgoingRequests: new Map(),
  loaded: false,
  loadedAt: -1,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@users/getRelationships'](state, action) {
    const { summary } = action.payload

    state.friends = new Map(summary.friends.map(r => [r.toId, r]))
    state.blocks = new Map(summary.blocks.map(r => [r.toId, r]))
    state.incomingRequests = new Map(summary.incomingRequests.map(r => [r.fromId, r]))
    state.outgoingRequests = new Map(summary.outgoingRequests.map(r => [r.toId, r]))

    state.loaded = true
    state.loadedAt = action.system.monotonicTime
  },

  ['@users/upsertRelationship'](state, { payload: { relationship }, meta: { selfId } }) {
    if (relationship.kind === UserRelationshipKind.Friend) {
      state.friends.set(relationship.toId, relationship)

      state.outgoingRequests.delete(relationship.toId)
      state.incomingRequests.delete(relationship.toId)
      state.blocks.delete(relationship.toId)
    } else if (relationship.kind === UserRelationshipKind.Block) {
      state.blocks.set(relationship.toId, relationship)

      state.outgoingRequests.delete(relationship.toId)
      state.incomingRequests.delete(relationship.toId)
      state.friends.delete(relationship.toId)
    } else if (relationship.kind === UserRelationshipKind.FriendRequest) {
      if (relationship.fromId === selfId) {
        state.outgoingRequests.set(relationship.toId, relationship)

        state.blocks.delete(relationship.toId)
        state.incomingRequests.delete(relationship.toId)
        state.friends.delete(relationship.toId)
      } else {
        state.incomingRequests.set(relationship.fromId, relationship)

        state.blocks.delete(relationship.fromId)
        state.outgoingRequests.delete(relationship.fromId)
        state.friends.delete(relationship.fromId)
      }
    } else {
      assertUnreachable(relationship.kind)
    }
  },

  ['@users/deleteRelationship'](state, { payload: { targetUser } }) {
    state.friends.delete(targetUser)
    state.blocks.delete(targetUser)
    state.incomingRequests.delete(targetUser)
    state.outgoingRequests.delete(targetUser)
  },

  [NETWORK_SITE_CONNECTED as any]() {
    return DEFAULT_STATE
  },
})
