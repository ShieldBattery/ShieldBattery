import {
  ACTIVITY_OVERLAY_OPEN,
  ACTIVITY_OVERLAY_CLOSE,
} from '../actions.js'

export function openOverlay(overlayType) {
  return {
    type: ACTIVITY_OVERLAY_OPEN,
    payload: {
      overlayType
    },
  }
}

export function closeOverlay() {
  return {
    type: ACTIVITY_OVERLAY_CLOSE,
  }
}
