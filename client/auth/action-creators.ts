import cuid from 'cuid'
import { TranslationLanguage } from '../../common/i18n'
import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl } from '../../common/urls'
import { SbUserId, SelfUser } from '../../common/users/sb-user'
import { ClientSessionInfo } from '../../common/users/session'
import type { PromisifiedAction, ReduxAction } from '../action-types'
import type { ThunkAction } from '../dispatch-registry'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { AccountUpdateSuccess, AuthChangeBegin } from './actions'
import { getBrowserprint } from './browserprint'

const typedIpc = new TypedIpcRenderer()

type IdRequestable = Extract<
  Exclude<ReduxAction, { error: true }>,
  { type: string; meta: { reqId: string; time: number } }
>

type IdRequestableTypes = IdRequestable['type']

function idRequest<
  ActionTypeName extends IdRequestableTypes,
  ActionType extends Extract<IdRequestable, { type: ActionTypeName }>,
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
      const promisified: PromisifiedAction<ActionType> = {
        type,
        payload,
        meta: { reqId, time: window.performance.now() },
        // NOTE(tec27): I think this cast is necessary because TS thinks this type *could* have
        // extra keys that need to be assigned, because we can't properly tell it what the valid
        // keys are?
      } as any as PromisifiedAction<ActionType>
      payload.then(resolve, reject)
      dispatch(promisified)
    }
  })

  return { id: reqId, action: thunk!, promise }
}

async function getExtraSessionData() {
  let extraData: { clientIds: [number, string][] }
  if (IS_ELECTRON) {
    extraData = { clientIds: (await typedIpc.invoke('securityGetClientIds')) ?? [] }
  } else {
    extraData = { clientIds: [[0, await getBrowserprint()]] }
  }

  return extraData
}

export function logIn(
  {
    username,
    password,
    remember,
    language,
  }: { username: string; password: string; remember: boolean; language: TranslationLanguage },
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<ClientSessionInfo>(apiUrl`sessions`, {
      method: 'post',
      body: JSON.stringify({
        ...(await getExtraSessionData()),
        username,
        password,
        remember: !!remember,
        language,
      }),
    })
    sessionStorage.clear()

    dispatch({
      type: '@auth/loadCurrentSession',
      payload: result,
    })
  })
}

export function logOut() {
  return idRequest('@auth/logOut', async () => {
    const result = await fetchJson<void>(apiUrl`sessions`, {
      method: 'delete',
    })
    sessionStorage.clear()
    return result
  })
}

export function signUp(
  {
    username,
    email,
    password,
    language,
  }: { username: string; email: string; password: string; language: TranslationLanguage },
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<ClientSessionInfo>(apiUrl`users`, {
      method: 'post',
      body: JSON.stringify({
        ...(await getExtraSessionData()),
        username,
        email,
        password,
        language,
      }),
    })
    window.fathom?.trackGoal('YTZ0JAUE', 0)
    sessionStorage.clear()

    dispatch({
      type: '@auth/loadCurrentSession',
      payload: result,
    })
  })
}

export function getCurrentSession(spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<ClientSessionInfo>(apiUrl`sessions?date=${Date.now()}`, {
      method: 'get',
    })

    dispatch({
      type: '@auth/loadCurrentSession',
      payload: result,
    })
  })
}

/**
 * "Loads" the session from what was sent on the page. This is only usable in web clients, since
 * Electron clients load a static local page. */
export function bootstrapSession(session?: ClientSessionInfo): ThunkAction {
  return dispatch => {
    if (session) {
      dispatch({
        type: '@auth/loadCurrentSession',
        payload: session,
      })
    }
  }
}

export function recoverUsername(email: string) {
  return idRequest('@auth/recoverUsername', () =>
    fetchJson<void>('/api/1/recovery/user', {
      method: 'post',
      body: JSON.stringify({
        email,
      }),
    }),
  )
}

export function startPasswordReset(username: string, email: string) {
  return idRequest('@auth/startPasswordReset', () =>
    fetchJson<void>('/api/1/recovery/password', {
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
    fetchJson<void>(url, {
      method: 'post',
      body: JSON.stringify({
        password,
      }),
    }),
  )
}

export function verifyEmail(userId: SbUserId, token: string) {
  return idRequest('@auth/verifyEmail', () =>
    fetchJson<void>(apiUrl`users/${userId}/email-verification`, {
      method: 'post',
      body: encodeBodyAsParams({ code: token }),
    }),
  )
}

export function sendVerificationEmail(userId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, () =>
    fetchJson<void>(apiUrl`users/${userId}/email-verification/send`, { method: 'post' }),
  )
}

export function updateAccount(userId: SbUserId, userProps: Partial<SelfUser>) {
  return idRequest('@auth/accountUpdate', () =>
    fetchJson<AccountUpdateSuccess['payload']>('/api/1/users/' + encodeURIComponent(userId), {
      method: 'PATCH',
      body: JSON.stringify(userProps),
    }),
  )
}
