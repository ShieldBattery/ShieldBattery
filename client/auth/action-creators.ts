import fetch from '../network/fetch'
import cuid from 'cuid'
import type { ThunkAction } from '../dispatch-registry'
import type { PromisifiedAction, ReduxAction } from '../action-types'
import { User, UserInfo } from '../../common/users/user-info'
import { AuthChangeBegin, AccountUpdateSuccess } from './actions'

type IdRequestable = Extract<
  Exclude<ReduxAction, { error: true }>,
  { type: string; meta: { reqId: string } }
>

type IdRequestableTypes = IdRequestable['type']

function idRequest<
  ActionTypeName extends IdRequestableTypes,
  ActionType extends Extract<IdRequestable, { type: ActionTypeName }>
>(
  type: ActionTypeName,
  fetcher: () => Promise<ActionType['payload']>,
): {
  id: string
  action: ThunkAction<ActionType | AuthChangeBegin>
  promise: Promise<ActionType['payload']>
} {
  const reqId = cuid()
  let thunk: ThunkAction<ActionType | AuthChangeBegin> | undefined
  const promise = new Promise<ActionType['payload']>((resolve, reject) => {
    thunk = dispatch => {
      dispatch({
        type: '@auth/changeBegin',
        payload: {
          reqId,
        },
      })

      const payload = fetcher()
      const promisified: PromisifiedAction<ActionType> = ({
        type,
        payload,
        meta: { reqId },
        // NOTE(tec27): I think this cast is necessary because TS thinks this type *could* have
        // extra keys that need to be assigned, because we can't properly tell it what the valid
        // keys are?
      } as any) as PromisifiedAction<ActionType>
      dispatch(promisified)
      payload.then(resolve, reject)
    }
  })

  return { id: reqId, action: thunk!, promise }
}

export function logIn(username: string, password: string, remember: boolean) {
  return idRequest('@auth/logIn', () =>
    fetch<UserInfo>('/api/1/sessions', {
      method: 'post',
      body: JSON.stringify({
        username,
        password,
        remember: !!remember,
      }),
    }),
  )
}

export function logOut() {
  return idRequest('@auth/logOut', () =>
    fetch<void>('/api/1/sessions', {
      method: 'delete',
    }),
  )
}

export function signUp(username: string, email: string, password: string) {
  const reqUrl = '/api/1/users'
  return idRequest('@auth/signUp', () =>
    fetch<UserInfo>(reqUrl, {
      method: 'post',
      body: JSON.stringify({ username, email, password }),
    }),
  )
}

export function getCurrentSession() {
  return idRequest('@auth/loadCurrentSession', () =>
    fetch<UserInfo>('/api/1/sessions?date=' + Date.now(), {
      method: 'get',
    }),
  )
}

export function recoverUsername(email: string) {
  return idRequest('@auth/recoverUsername', () =>
    fetch<void>('/api/1/recovery/user', {
      method: 'post',
      body: JSON.stringify({
        email,
      }),
    }),
  )
}

export function startPasswordReset(username: string, email: string) {
  return idRequest('@auth/startPasswordReset', () =>
    fetch<void>('/api/1/recovery/password', {
      method: 'post',
      body: JSON.stringify({
        username,
        email,
      }),
    }),
  )
}

export function resetPassword(username: string, code: string, password: string) {
  const url =
    '/api/1/users/' + encodeURIComponent(username) + '/password?code=' + encodeURIComponent(code)
  return idRequest('@auth/resetPassword', () =>
    fetch<void>(url, {
      method: 'post',
      body: JSON.stringify({
        password,
      }),
    }),
  )
}

export function verifyEmail(token: string) {
  const url = `/api/1/users/emailVerification?code=${encodeURIComponent(token)}`

  return idRequest('@auth/verifyEmail', () => fetch<void>(url, { method: 'post' }))
}

export function sendVerificationEmail() {
  const url = '/api/1/users/sendVerification'

  return idRequest('@auth/sendVerificationEmail', () => fetch<void>(url, { method: 'post' }))
}

export function updateAccount(userId: number, userProps: Partial<User>) {
  return idRequest('@auth/accountUpdate', () =>
    fetch<AccountUpdateSuccess['payload']>('/api/1/users/' + encodeURIComponent(userId), {
      method: 'PATCH',
      body: JSON.stringify(userProps),
    }),
  )
}
