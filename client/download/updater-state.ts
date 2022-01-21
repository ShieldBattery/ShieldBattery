import produce, { Draft, Immutable } from 'immer'

// NOTE(tec27): We avoid using normal Redux stuff for this because we want it to be detached from
// the main store, and to have the UI render outside of the normal path of components. By doing so,
// we make updates more resilient to application errors (e.g. in the past we've seen that API
// changes might break a reducer and therefore break the UI, if our updater depends on normal
// reducer state then the only recourse is to re-download the client from our website).

export interface UpdateState {
  hasUpdate: boolean
  hasDownloadError: boolean
  readyToInstall: boolean
}

export type UpdateStateChangeHandler = (state: UpdateState) => void

const changeHandlers = new Set<UpdateStateChangeHandler>()
let currentState: Immutable<UpdateState> = {
  hasUpdate: false,
  hasDownloadError: false,
  readyToInstall: false,
}

export function addChangeHandler(handler: UpdateStateChangeHandler) {
  changeHandlers.add(handler)
  queueMicrotask(() => {
    if (changeHandlers.has(handler)) {
      handler(currentState)
    }
  })
}

export function removeChangeHandler(handler: UpdateStateChangeHandler) {
  changeHandlers.delete(handler)
}

export function changeUpdateState(changeFn: (draft: Draft<UpdateState>) => void) {
  currentState = produce(currentState, changeFn)
  queueMicrotask(() => {
    for (const handler of changeHandlers) {
      handler(currentState)
    }
  })
}
