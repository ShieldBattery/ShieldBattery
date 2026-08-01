import { useHistoryState } from 'wouter/use-browser-location'
import { ThunkAction } from '../../dispatch-registry'
import { pushCurrentWithState } from '../../navigation/routing'

const CHANNEL_SETTINGS_OPEN_STATE = 'CHANNEL_SETTINGS:open'

/** Returns whether the channel settings UI is currently open. */
export function useIsChannelSettingsOpen(): boolean {
  return useHistoryState() === CHANNEL_SETTINGS_OPEN_STATE
}

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
