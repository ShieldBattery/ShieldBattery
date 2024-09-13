import { TypedIpcRenderer } from '../../common/ipc.js'
import { dispatch } from '../dispatch-registry.js'
import { showReplayInfo, startReplay } from './action-creators.js'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer.on('replaysOpen', (event, replayPaths) => {
    // TODO(tec27): Handle multiple replays at once
    dispatch((dispatch, getState) => {
      const {
        settings: { local },
      } = getState()

      if (local.quickOpenReplays) {
        dispatch(startReplay({ path: replayPaths[0] }))
      } else {
        dispatch(showReplayInfo(replayPaths[0]))
      }
    })
  })
}
