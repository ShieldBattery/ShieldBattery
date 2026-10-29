import type { App } from 'electron'
import type { LocalGameManager } from './local-game-manager'

/** Keeps game IPC and bot supervisors alive through normal local-game teardown. */
export function waitForLocalGameOnQuit(
  app: Pick<App, 'on' | 'quit'>,
  manager: Pick<LocalGameManager, 'isActive' | 'stop'>,
  onError: (error: unknown) => void,
): void {
  let finished = false
  let stopping: Promise<void> | undefined
  app.on('before-quit', event => {
    if (finished || (!stopping && !manager.isActive())) return
    event.preventDefault()
    stopping ??= Promise.resolve()
      .then(() => manager.stop())
      .then(
        () => {
          finished = true
          app.quit()
        },
        error => {
          // Retain the host and native owners until termination is confirmed. A later quit can
          // retry the cleanup without abandoning a process whose termination failed.
          stopping = undefined
          onError(error)
        },
      )
  })
}
