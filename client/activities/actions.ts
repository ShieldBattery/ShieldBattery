import { ActivityOverlayPayload } from './activity-overlay-type.js'

export type ActivityOverlayActions =
  | OpenActivityOverlay
  | CloseActivityOverlay
  | PreviousActivityOverlay

export interface OpenActivityOverlay {
  type: '@activities/open'
  payload: ActivityOverlayPayload
  meta: {
    id: string
  }
}

export interface CloseActivityOverlay {
  type: '@activities/close'
}

export interface PreviousActivityOverlay {
  type: '@activities/back'
}
