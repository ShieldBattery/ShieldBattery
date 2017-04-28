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
  })
}
