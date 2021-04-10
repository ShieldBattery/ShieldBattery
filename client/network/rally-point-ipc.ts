import { RALLY_POINT_REFRESH_PINGS } from '../../common/ipc-constants'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : undefined

export function refreshRallyPointPings() {
  return ipcRenderer?.send(RALLY_POINT_REFRESH_PINGS)
}
