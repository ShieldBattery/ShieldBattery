import { TypedIpcRenderer } from '../../common/ipc'
import { dispatch } from '../dispatch-registry'
import { openReplay } from './action-creators'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer.on('openReplay', (_, replay) => dispatch(openReplay(replay)))
}
