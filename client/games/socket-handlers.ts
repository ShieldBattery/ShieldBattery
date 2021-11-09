import { TypedIpcRenderer } from '../../common/ipc'
import { dispatch } from '../dispatch-registry'

export default function ({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer.on('activeGameResult', (event, { gameId, result, time }) => {
    dispatch({
      type: '@games/deliverLocalResults',
      payload: {
        gameId,
        result,
        time,
      },
    })
  })
}
