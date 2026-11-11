/** The parts of a `BrowserWindow` that going to and from the tray uses. */
export interface TrayWindow {
  isMaximized(): boolean
  isMinimized(): boolean
  minimize(): void
  maximize(): void
  restore(): void
  hide(): void
  show(): void
  focus(): void
}

/**
 * How the window was before it went to the tray, while it's there.
 *
 * It goes minimized: Chromium's native window occlusion tracking hooks location changes from every
 * other process with a visible window, so this app is woken for each mouse message a game takes,
 * and it only drops those hooks while all of its windows are minimized. Hidden alone doesn't count.
 */
let inTray: 'normal' | 'maximized' | undefined

/** Hides the window to the tray. */
export function hideToTray(window: TrayWindow) {
  inTray = window.isMaximized() ? 'maximized' : 'normal'
  window.minimize()
  window.hide()
}

/**
 * Shows the window, the way it was before it went to the tray if it's there.
 *
 * Showing a minimized window brings it back at its normal size, from which maximizing it animates,
 * so a window that was maximized is maximized while still hidden instead, which shows it already
 * maximized.
 */
export function showWindow(window: TrayWindow) {
  const was = inTray
  inTray = undefined
  if (was === 'maximized') {
    window.maximize()
    window.focus()
    return
  }
  window.show()
  if (window.isMinimized()) {
    window.restore()
  }
}
