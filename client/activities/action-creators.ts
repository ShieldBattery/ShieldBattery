import { CloseActivityOverlay, OpenActivityOverlay, PreviousActivityOverlay } from './actions'
import { ActivityOverlayPayload } from './activity-overlay-type'

export function openOverlay(payload: ActivityOverlayPayload): OpenActivityOverlay {
  return {
    type: '@activities/open',
    payload,
  }
}

export function closeOverlay(): CloseActivityOverlay {
  return {
    type: '@activities/close',
  }
}

export function goBack(): PreviousActivityOverlay {
  return {
    type: '@activities/back',
  }
}
