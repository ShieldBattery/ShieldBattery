import { ThunkAction } from '../../dispatch-registry'
import { pushCurrentWithState } from '../../navigation/routing'

export const CHANNEL_SETTINGS_OPEN_STATE = 'CHANNEL_SETTINGS:open'

export function openChannelSettings(): ThunkAction {
  return () => {
    if (history.state !== CHANNEL_SETTINGS_OPEN_STATE) {
      pushCurrentWithState(CHANNEL_SETTINGS_OPEN_STATE)
    }
  }
}

export function closeChannelSettings(): ThunkAction {
  return () => {
    if (history.state === CHANNEL_SETTINGS_OPEN_STATE) {
      history.back()
    }
  }
}
