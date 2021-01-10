import type { PromisifiedAction, ReduxAction } from './action-types'

// TODO(tec27): Use a type for our root Store instead of any
export type ThunkAction<T extends ReduxAction> = (
  dispatch: DispatchFunction<T>,
  getState: () => any,
) => void
export type Dispatchable<T extends ReduxAction = ReduxAction> =
  | T
  | ThunkAction<T>
  | PromisifiedAction<T>
export type DispatchFunction<T extends ReduxAction> = (action: Dispatchable<T>) => void

let dispatcherFunc: DispatchFunction<ReduxAction> | null = null

export function registerDispatch(dispatch: DispatchFunction<ReduxAction>) {
  dispatcherFunc = dispatch
}

export function dispatch<T extends ReduxAction = ReduxAction>(action: Dispatchable<T>) {
  return dispatcherFunc!(action as ReduxAction)
}
