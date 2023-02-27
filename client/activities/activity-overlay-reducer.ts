import { Immutable } from 'immer'
import { NETWORK_SITE_DISCONNECTED } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import { ActivityOverlayPayload, ActivityOverlayType } from './activity-overlay-type'

export interface ActivityOverlayState<T extends ActivityOverlayType = ActivityOverlayType> {
  type: T
  initData?: (ActivityOverlayPayload & { type: T })['initData']
}

export interface ActivityOverlayHistory {
  history: Array<ActivityOverlayState>
}

const DEFAULT_ACTIVITY_OVERLAY_STATE: Immutable<ActivityOverlayHistory> = {
  history: [],
}

export default immerKeyedReducer(DEFAULT_ACTIVITY_OVERLAY_STATE, {
  ['@activities/open'](state, action) {
    const { type, initData } = action.payload
    state.history.push({ type, initData: initData as any })
  },

  ['@activities/close'](state) {
    state.history.length = 0
  },

  ['@activities/back'](state) {
    state.history.pop()
  },

  [NETWORK_SITE_DISCONNECTED as any]() {
    return DEFAULT_ACTIVITY_OVERLAY_STATE
  },
})
