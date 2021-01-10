import { AuthActions } from './auth/actions'

export type ReduxAction = Extract<AuthActions, { type: string }>

export type PromisifiedAction<T extends ReduxAction> = {
  [key in keyof T]: key extends 'payload' ? Promise<T[key]> : T[key]
}
