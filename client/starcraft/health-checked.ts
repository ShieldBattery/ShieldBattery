import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import { shieldBatteryHealthy, starcraftHealthy } from './health-state'

/**
 * Returns a function that will call the provided callback if all the health checks pass,
 * and display the relevant dialog to correct problems if they don't.
 */
export function healthChecked<T extends unknown[]>(cb: (...args: T) => void): (...args: T) => void {
  return (...args: T) => {
    if (!jotaiStore.get(starcraftHealthy)) {
      dispatch(openDialog({ type: DialogType.StarcraftHealth }))
    } else if (!jotaiStore.get(shieldBatteryHealthy)) {
      dispatch(openDialog({ type: DialogType.ShieldBatteryHealth }))
    } else {
      cb(...args)
    }
  }
}
