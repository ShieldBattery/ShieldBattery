import { List, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { ACTIVITY_OVERLAY_OPEN, ACTIVITY_OVERLAY_CLOSE, ACTIVITY_OVERLAY_GO_BACK } from '../actions'

const OverlayStateBase = new Record({
  overlayType: null,
  history: new List(),
})
export class OverlayState extends OverlayStateBase {
  get isOverlayOpened() {
    return this.overlayType != null
  }
}

export default keyedReducer(new OverlayState(), {
  [ACTIVITY_OVERLAY_OPEN](state, action) {
    const { overlayType } = action.payload
    return state.set('overlayType', overlayType).update('history', h => h.push(overlayType))
  },

  [ACTIVITY_OVERLAY_CLOSE](state, action) {
    return new OverlayState()
  },

  [ACTIVITY_OVERLAY_GO_BACK](state, action) {
    const updatedState = state.update('history', h => h.pop())
    return updatedState.history.size > 0
      ? updatedState.set('overlayType', updatedState.history.last())
      : updatedState.delete('overlayType')
  },
})
