import { useEffect, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import logger from '../logging/logger'

export type WindowFocusListener = (focused: boolean) => void

/**
 * Tracks the current focus state of the window (using either browser events, or IPC from the
 * main Electron process).
 */
export class WindowFocusTracker {
  readonly ipcRenderer = new TypedIpcRenderer()
  private focused = false
  private listeners: WindowFocusListener[] = []
  private microtaskNotifyQueue: WindowFocusListener[] = []

  constructor() {
    if (!IS_ELECTRON) {
      this.focused = document.visibilityState === 'visible'
      document.addEventListener('visibilitychange', () => {
        this.focused = document.visibilityState === 'visible'
        this.notifyListeners()
      })
    } else {
      this.ipcRenderer.on('windowFocusChanged', (_, focused) => {
        this.focused = focused
        this.notifyListeners()
      })

      this.ipcRenderer
        .invoke('windowGetStatus')
        ?.then(({ focused }) => {
          this.focused = focused
          this.notifyListeners()
        })
        .catch(err => {
          logger.error(`Failed to get initial window focus status: ${getErrorStack(err)}`)
        })
    }
  }

  isFocused(): boolean {
    return this.focused
  }

  addListener(listener: WindowFocusListener) {
    this.listeners.push(listener)
    this.microtaskNotifyQueue.push(listener)
    queueMicrotask(() => {
      for (const l of this.microtaskNotifyQueue) {
        l(this.focused)
      }

      this.microtaskNotifyQueue = []
    })
  }

  removeListener(listener: WindowFocusListener) {
    const index = this.listeners.indexOf(listener)
    if (index !== -1) {
      this.listeners.splice(index, 1)
    }

    const microtaskIndex = this.microtaskNotifyQueue.indexOf(listener)
    if (microtaskIndex !== -1) {
      this.microtaskNotifyQueue.splice(microtaskIndex, 1)
    }
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener(this.focused)
    }
  }
}

const windowFocusTracker = new WindowFocusTracker()
export default windowFocusTracker

/**
 * Hook that returns whether the window is currently focused (e.g. the tab or app is currently
 * visible. This will work in Electron and the browser, although the semantics are slightly
 * different.
 */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    windowFocusTracker.addListener(setFocused)

    return () => {
      windowFocusTracker.removeListener(setFocused)
    }
  }, [])

  return focused
}
