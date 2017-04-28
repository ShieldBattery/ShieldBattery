import { dispatch } from '../dispatch-registry'
import {
  WINDOW_CONTROLS_MAXIMIZED_STATE,
} from '../actions'
import {
  WINDOW_MAXIMIZED_STATE,
} from '../../app/common/ipc-constants'

export default function registerModule({ ipcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  ipcRenderer.on(WINDOW_MAXIMIZED_STATE, (event, isMaximized) => {
    if (isMaximized) {
      document.body.classList.add('maximized')
    } else {
      document.body.classList.remove('maximized')
    }

    dispatch({
      type: WINDOW_CONTROLS_MAXIMIZED_STATE,
      payload: isMaximized
    })
  })
}
