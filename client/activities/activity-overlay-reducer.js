import { Record } from 'immutable'
import {
  ACTIVITY_OVERLAY_OPEN,
  ACTIVITY_OVERLAY_CLOSE,
} from '../actions'

const OverlayStateBase = new Record({
  overlayType: null,
})
export class OverlayState extends OverlayStateBase {
  get isOverlayOpened() {
    return this.overlayType != null
  }
}

export default function activityOverlayReducer(state = new OverlayState(), action) {
  if (action.type === ACTIVITY_OVERLAY_OPEN) {
    return state.set('overlayType', action.payload.overlayType)
  } else if (action.type === ACTIVITY_OVERLAY_CLOSE) {
    return state.delete('overlayType')
  }

  return state
}
