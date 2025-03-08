export interface SnackbarOptions {
  /** An optional action button to show on the snackbar. */
  action?: {
    label: string
    onClick: () => void
  }
  /**
   * An optional signal that can be used to dismiss the snackbar before its duration is complete.
   */
  signal?: AbortSignal
  /** A value that will be set as `data-test` on the snackbar element. */
  testName?: string
}

export interface SnackbarController {
  showSnackbar(message: string, durationMillis?: number, options?: SnackbarOptions): void
}

// NOTE(tec27): This lets us deal with sending snackbars from outside the normal React component
// tree. Not ideal that this needs to exist, but I'd rather have this than need to restructure
// all the existing places that do this right now.
const registry = new Set<SnackbarController>()

export function registerSnackbarController(controller: SnackbarController) {
  registry.add(controller)
}

export function unregisterSnackbarController(controller: SnackbarController) {
  registry.delete(controller)
}

/**
 * A utility for showing snackbars from outside the React component tree. If you are showing a
 * snackbar from inside a component, use `useSnackbarController` instead.
 */
export function externalShowSnackbar(
  message: string,
  durationMillis?: number,
  options?: SnackbarOptions,
) {
  for (const controller of registry) {
    controller.showSnackbar(message, durationMillis, options)
  }
}
