import { Immutable } from 'immer'
import { immerKeyedReducer } from '../reducers/keyed-reducer.js'
import { ActivityOverlayPayload, ActivityOverlayType } from './activity-overlay-type.js'

export interface ActivityOverlayState<T extends ActivityOverlayType = ActivityOverlayType> {
  type: T
  initData?: (ActivityOverlayPayload & { type: T })['initData']
  id: string
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
    state.history.push({ type, initData: initData as any, id: action.meta.id })
  },

  ['@activities/close'](state) {
    state.history.length = 0
  },

  ['@activities/back'](state) {
    state.history.pop()
  },

  ['@network/disconnect']() {
    return DEFAULT_ACTIVITY_OVERLAY_STATE
  },
})
