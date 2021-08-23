/**
 * Redux middleware that adds a `system` key to actions, containing information that is usedful for
 * reducers to have for most actions (but is painful to add by hand). This includes information
 * like the current monotonic system time when the action was dispatched.
 *
 * This should always be added at a point in the middleware chain where all actions are actually
 * action objects (and not e.g. thunks or promises).
 */
export function addSystemMiddleware(): any {
  // TODO(tec27): Figure out the actual types here. They're kind of a mess and it's maybe not worth
  // it though.
  return (next: any) => (action: any) => {
    const system: ReduxSystemInfo = {
      monotonicTime: window.performance.now(),
    }

    next({
      ...action,
      system,
    })
  }
}

/**
 * A Redux action that has had system information added to it by middleware.
 */
export interface ActionWithSystemInfo {
  /** System information added by the Redux store middleware. */
  system: ReduxSystemInfo
}

export interface ReduxSystemInfo {
  /**
   * The current monotonic time value when this action was dispatched. This is time on the local
   * system only. It is safe to store and reference for the lifetime of the current application
   * instance only (i.e. it is not comparable across separate application launches, or something
   * you should save to a file).
   *
   * @see window.performance.now
   */
  monotonicTime: number
}
