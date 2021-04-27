import { TypedIpcRenderer } from '../../common/ipc'
import { ReduxAction } from '../action-types'
import { SHIELDBATTERY_FILES_VALIDITY } from '../actions'
import { DispatchFunction } from '../dispatch-registry'

const ipcRenderer = new TypedIpcRenderer()

export function checkShieldBatteryFiles(dispatch: DispatchFunction<ReduxAction>) {
  ipcRenderer.invoke('shieldbatteryCheckFiles')?.then(fileResults => {
    dispatch({
      type: SHIELDBATTERY_FILES_VALIDITY,
      payload: fileResults,
    } as any)
  })
}
