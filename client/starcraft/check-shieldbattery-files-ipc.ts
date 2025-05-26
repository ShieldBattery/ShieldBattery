import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { ReduxAction } from '../action-types'
import { DispatchFunction } from '../dispatch-registry'

const ipcRenderer = new TypedIpcRenderer()

export function checkShieldBatteryFiles(dispatch: DispatchFunction<ReduxAction>) {
  ipcRenderer
    .invoke('shieldbatteryCheckFiles')
    ?.then(fileResults => {
      dispatch({
        type: '@starcraft/shieldBatteryFilesValidity',
        payload: fileResults,
      })
    })
    .catch(swallowNonBuiltins)
}
