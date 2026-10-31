import type { App, BrowserWindow, Dialog, MessageBoxOptions } from 'electron'
import type { LocalGameManager } from './local-game-manager'

export type CleanupFailureChoice = 'retry' | 'cancel'

/** A dismissed dialog cancels quitting; only an explicit retry requests more cleanup. */
export async function promptForLocalGameCleanup(
  dialog: Pick<Dialog, 'showMessageBox'>,
  parent?: BrowserWindow | null,
): Promise<CleanupFailureChoice> {
  const options: MessageBoxOptions = {
    type: 'warning',
    title: 'Game still running',
    message: "ShieldBattery couldn't confirm that the game has closed.",
    detail:
      'Retry cleanup to close the game and quit, or cancel quitting to keep ShieldBattery open.',
    buttons: ['Retry cleanup', 'Cancel quit'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  let result
  if (parent && !parent.isDestroyed()) {
    if (parent.isMinimized()) parent.restore()
    parent.show()
    parent.focus()
    result = await dialog.showMessageBox(parent, options)
  } else {
    result = await dialog.showMessageBox(options)
  }
  return result.response === 0 ? 'retry' : 'cancel'
}

/** Keeps game IPC and bot supervisors alive through normal local-game teardown. */
export function waitForLocalGameOnQuit(
  app: Pick<App, 'on' | 'quit'>,
  manager: Pick<LocalGameManager, 'isActive' | 'stop'>,
  onError: (error: unknown) => void,
  chooseAfterFailure: () => Promise<CleanupFailureChoice>,
): void {
  let finished = false
  let stopping: Promise<void> | undefined
  app.on('before-quit', event => {
    if (finished || (!stopping && !manager.isActive())) return
    event.preventDefault()
    stopping ??= Promise.resolve()
      .then(async () => {
        for (;;) {
          try {
            await manager.stop()
            finished = true
            app.quit()
            return
          } catch (error) {
            onError(error)
          }
          // Keep ownership and the host alive while the choice is pending. Repeated quit events
          // share this flow, so they cannot create overlapping dialogs or cleanup attempts.
          if ((await chooseAfterFailure()) !== 'retry') return
        }
      })
      .catch(onError)
      .finally(() => {
        stopping = undefined
      })
  })
}
