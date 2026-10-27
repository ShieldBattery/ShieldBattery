import { useEffect, useState } from 'react'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import logger from '../logging/logger'

export type WindowFocusListener = (focused: boolean) => void

/** How often focus is rechecked while it's inside one of the page's iframes. */
const IFRAME_FOCUS_POLL_MS = 1000

/**
 * Tracks whether the window has the OS focus (using either browser events, or IPC from the main
 * Electron process).
 */
export class WindowFocusTracker {
  readonly ipcRenderer = new TypedIpcRenderer()
  private focused = false
  private listeners: WindowFocusListener[] = []
  private microtaskNotifyQueue: WindowFocusListener[] = []
  private iframeFocusPoll: ReturnType<typeof setInterval> | undefined

  constructor() {
    if (!IS_ELECTRON) {
      this.focused = document.hasFocus()
      window.addEventListener('focus', this.updateFromDocument)
      // Focus moving into one of the page's own iframes (an embedded video, say) blurs the window
      // too, but the user is still on the page. `hasFocus` counts that as focused, once the move
      // has finished, which is after `blur` is dispatched.
      window.addEventListener('blur', () => setTimeout(this.updateFromDocument, 0))
      document.addEventListener('visibilitychange', this.updateFromDocument)
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

  private updateFromDocument = () => {
    // Leaving the browser from inside an iframe dispatches nothing to this window, so that has to
    // be noticed by checking.
    const inIframe = document.activeElement instanceof HTMLIFrameElement
    if (inIframe && !this.iframeFocusPoll) {
      this.iframeFocusPoll = setInterval(this.updateFromDocument, IFRAME_FOCUS_POLL_MS)
    } else if (!inIframe && this.iframeFocusPoll) {
      clearInterval(this.iframeFocusPoll)
      this.iframeFocusPoll = undefined
    }

    const focused = document.hasFocus()
    if (focused !== this.focused) {
      this.focused = focused
      this.notifyListeners()
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
 * Hook that returns whether the window currently has the OS focus. In the browser, that means the
 * page's tab is the active one in the focused browser window.
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
