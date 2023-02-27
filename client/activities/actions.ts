import { ActivityOverlayPayload } from './activity-overlay-type'

export type ActivityOverlayActions =
  | OpenActivityOverlay
  | CloseActivityOverlay
  | PreviousActivityOverlay

export interface OpenActivityOverlay {
  type: '@activities/open'
  payload: ActivityOverlayPayload
}

export interface CloseActivityOverlay {
  type: '@activities/close'
}

export interface PreviousActivityOverlay {
  type: '@activities/back'
}
