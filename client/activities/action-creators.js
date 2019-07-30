import { ACTIVITY_OVERLAY_OPEN, ACTIVITY_OVERLAY_CLOSE, ACTIVITY_OVERLAY_GO_BACK } from '../actions'

export function openOverlay(overlayType) {
  return {
    type: ACTIVITY_OVERLAY_OPEN,
    payload: {
      overlayType,
    },
  }
}

export function closeOverlay() {
  return (dispatch, getState) => {
    dispatch({
      type: ACTIVITY_OVERLAY_CLOSE,
      meta: { overlayType: getState().activityOverlay.overlayType },
    })
  }
}

export function goBack() {
  return {
    type: ACTIVITY_OVERLAY_GO_BACK,
  }
}
