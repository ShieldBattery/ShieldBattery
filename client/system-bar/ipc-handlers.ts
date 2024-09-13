import { TypedIpcRenderer } from '../../common/ipc.js'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  ipcRenderer.on('windowMaximizedState', (event, isMaximized) => {
    if (isMaximized) {
      document.body.classList.add('maximized')
    } else {
      document.body.classList.remove('maximized')
    }
  })
}
