import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { ACTIVITY_OVERLAY_OPEN, ACTIVITY_OVERLAY_CLOSE, ACTIVITY_OVERLAY_GO_BACK } from '../actions'

const OverlayRecord = new Record({
  overlayType: null,
  initData: new Map(),
})
const OverlayStateBase = new Record({
  history: new List(),
})
export class OverlayState extends OverlayStateBase {
  get current() {
    return this.history.last()
  }
  get isOverlayOpened() {
    return this.history.size > 0
  }
}

export default keyedReducer(new OverlayState(), {
  [ACTIVITY_OVERLAY_OPEN](state, action) {
    const { overlayType, initData } = action.payload
    const overlayRecord = new OverlayRecord({
      overlayType,
      initData: new Map(Object.entries(initData)),
    })

    return state.update('history', h => h.push(overlayRecord))
  },

  [ACTIVITY_OVERLAY_CLOSE](state, action) {
    return new OverlayState()
  },

  [ACTIVITY_OVERLAY_GO_BACK](state, action) {
    return state.update('history', h => h.pop())
  },
})
