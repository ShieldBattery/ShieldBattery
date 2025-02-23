import cuid from 'cuid'
import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl, urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { ClientSessionInfo } from '../../common/users/session'
import type { PromisifiedAction, ReduxAction } from '../action-types'
import { dispatch, type ThunkAction } from '../dispatch-registry'
import { maybeChangeLanguageLocally } from '../i18n/action-creators'
import logger from '../logging/logger'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import {
  CREDENTIAL_STORAGE,
  CredentialStorageType,
  encodeBodyAsParams,
  fetchJson,
} from '../network/fetch'
import { AuthChangeBegin } from './actions'
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

let sessionRefreshTimeout: ReturnType<typeof setTimeout> | undefined
function scheduleSessionRefresh() {
  if (sessionRefreshTimeout) {
    clearTimeout(sessionRefreshTimeout)
  }

  // 24 hours with 30 minute jtter
  const jitter = Math.random() * 1000 * 60 * 30 - 1000 * 60 * 15
  const time = 1000 * 60 * 60 * 24 + jitter

  sessionRefreshTimeout = setTimeout(() => {
    sessionRefreshTimeout = undefined
    dispatch(
      getCurrentSession(
        {},
        {
          onSuccess() {},
          onError(err) {
            logger.error(`Error refreshing session: ${err?.stack ?? String(err)}`)
          },
        },
      ),
    )
  }, time)
}

function clearSessionRefresh() {
  if (sessionRefreshTimeout) {
    clearTimeout(sessionRefreshTimeout)
    sessionRefreshTimeout = undefined
  }
}

function initSession(
  session: ClientSessionInfo,
  storageType = CredentialStorageType.Auto,
): ThunkAction {
  return dispatch => {
    CREDENTIAL_STORAGE.store(session.jwt, storageType)
    dispatch({
      type: '@auth/loadCurrentSession',
      payload: session,
    })

    dispatch(maybeChangeLanguageLocally(session.user.locale))
    scheduleSessionRefresh()
  }
}

export function logIn(
  {
    username,
    password,
    remember,
    locale,
  }: { username: string; password: string; remember: boolean; locale?: string },
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
        locale,
      }),
    })

    dispatch(
      initSession(result, remember ? CredentialStorageType.Local : CredentialStorageType.Session),
    )
  })
}

export function logOut() {
  return idRequest('@auth/logOut', async () => {
    const result = await fetchJson<void>(apiUrl`sessions`, {
      method: 'delete',
    })
    CREDENTIAL_STORAGE.store(undefined)
    clearSessionRefresh()

    return result
  })
}

export function signUp(
  {
    username,
    email,
    password,
    locale,
  }: { username: string; email: string; password: string; locale?: string },
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
        locale,
      }),
    })
    window.fathom?.trackGoal('YTZ0JAUE', 0)

    dispatch(initSession(result, CredentialStorageType.Session))
  })
}

export function getCurrentSession(
  { locale }: { locale?: string },
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<ClientSessionInfo>(
      apiUrl`sessions?date=${Date.now()}` + (locale ? urlPath`&locale=${locale}` : ''),
      {
        method: 'get',
      },
    )

    dispatch(initSession(result))
  })
}

/**
 * "Loads" the session from what was sent on the page. This is only usable in web clients, since
 * Electron clients load a static local page. */
export function bootstrapSession(session?: ClientSessionInfo): ThunkAction {
  return dispatch => {
    if (session) {
      dispatch(initSession(session))
    }
  }
}

export function revokeSession(): ThunkAction {
  return dispatch => {
    dispatch({ type: '@auth/sessionUnauthorized', payload: undefined })
    CREDENTIAL_STORAGE.store(undefined)
    clearSessionRefresh()
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
