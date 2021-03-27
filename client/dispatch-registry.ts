import type { PromisifiedAction, ReduxAction } from './action-types'
import { RootState } from './root-reducer'

export type ThunkAction<T extends ReduxAction = ReduxAction> = (
  dispatch: DispatchFunction<T>,
  getState: () => RootState,
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
