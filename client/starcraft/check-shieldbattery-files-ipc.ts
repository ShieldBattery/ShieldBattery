import swallowNonBuiltins from '../../common/async/swallow-non-builtins.js'
import { TypedIpcRenderer } from '../../common/ipc.js'
import { ReduxAction } from '../action-types.js'
import { SHIELDBATTERY_FILES_VALIDITY } from '../actions.js'
import { DispatchFunction } from '../dispatch-registry.js'

const ipcRenderer = new TypedIpcRenderer()

export function checkShieldBatteryFiles(dispatch: DispatchFunction<ReduxAction>) {
  ipcRenderer
    .invoke('shieldbatteryCheckFiles')
    ?.then(fileResults => {
      dispatch({
        type: SHIELDBATTERY_FILES_VALIDITY,
        payload: fileResults,
      } as any)
    })
    .catch(swallowNonBuiltins)
}
