import cuid from 'cuid'
import { CloseActivityOverlay, OpenActivityOverlay, PreviousActivityOverlay } from './actions'
import { ActivityOverlayPayload } from './activity-overlay-type'

export function openOverlay(payload: ActivityOverlayPayload): OpenActivityOverlay {
  return {
    type: '@activities/open',
    payload,
    meta: {
      id: cuid(),
    },
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
