import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { ShieldBatteryFile } from '../../common/shieldbattery-file'
import { jotaiStore } from '../jotai-store'
import { shieldBatteryFilesState } from './health-state'

const ipcRenderer = new TypedIpcRenderer()

export function checkShieldBatteryFiles() {
  ipcRenderer
    .invoke('shieldbatteryCheckFiles')
    ?.then(fileResults => {
      const filesMap = new Map(fileResults)
      jotaiStore.set(shieldBatteryFilesState, {
        init: filesMap.get(ShieldBatteryFile.Init) ?? false,
        main: filesMap.get(ShieldBatteryFile.Main) ?? false,
      })
    })
    .catch(swallowNonBuiltins)
}
