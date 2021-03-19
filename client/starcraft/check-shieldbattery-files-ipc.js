import { SHIELDBATTERY_FILES_CHECK } from '../../common/ipc-constants'
import { SHIELDBATTERY_FILES_VALIDITY } from '../actions'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : undefined

export function checkShieldBatteryFiles(dispatch) {
  ipcRenderer?.invoke(SHIELDBATTERY_FILES_CHECK).then(fileResults => {
    dispatch({
      type: SHIELDBATTERY_FILES_VALIDITY,
      payload: fileResults,
    })
  })
}
