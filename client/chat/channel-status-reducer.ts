import { Immutable } from 'immer'
import { ChannelStatus, SbChannelId } from '../../common/chat'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface ChannelStatusState {
  byId: Map<SbChannelId, ChannelStatus>
}

const DEFAULT_STATE: Immutable<ChannelStatusState> = {
  byId: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@chat/findChannel'](state, action) {
    state.byId.set(action.payload.id, action.payload)
  },
})
