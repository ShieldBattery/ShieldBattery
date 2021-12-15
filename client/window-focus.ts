import { TypedIpcRenderer } from '../common/ipc'

/**
 * Tracks the current focus state of the window (using either browser events, or IPC from the
 * main Electron process).
 */
export class WindowFocusTracker {
  readonly ipcRenderer = new TypedIpcRenderer()
  private focused = false

  constructor() {
    if (!IS_ELECTRON) {
      this.focused = document.hasFocus()
      document.addEventListener('focus', () => {
        this.focused = true
      })
      document.addEventListener('blur', () => {
        this.focused = false
      })
    } else {
      this.ipcRenderer.on('windowFocusChanged', (_, focused) => {
        this.focused = focused
      })
    }
  }

  isFocused(): boolean {
    return this.focused
  }
}

export default new WindowFocusTracker()
