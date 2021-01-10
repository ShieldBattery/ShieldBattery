import { AuthActions } from './auth/actions'

export type ReduxAction = AuthActions

export type PromisifiedAction<T extends ReduxAction> = {
  [key in keyof T]: key extends 'payload' ? Promise<T[key]> : T[key]
}
