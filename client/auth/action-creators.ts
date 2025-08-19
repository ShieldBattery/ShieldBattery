import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl, urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { ClientSessionInfo } from '../../common/users/session'
import {
  RecoverUsernameRequest,
  RequestPasswordResetRequest,
  ResetPasswordRequest,
} from '../../common/users/user-network'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
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

const typedIpc = new TypedIpcRenderer()

async function getExtraSessionData() {
  let extraData: { clientIds: [number, string][] }
  if (IS_ELECTRON) {
    extraData = { clientIds: (await typedIpc.invoke('securityGetClientIds')) ?? [] }
  } else {
    extraData = { clientIds: [] }
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
  wasSignup = false,
): ThunkAction {
  return dispatch => {
    CREDENTIAL_STORAGE.store(session.jwt, storageType)
    dispatch({
      type: '@auth/loadCurrentSession',
      payload: session,
    })

    dispatch(maybeChangeLanguageLocally(session.user.locale))
    scheduleSessionRefresh()

    if (
      !wasSignup &&
      !session.user.emailVerified &&
      !localStorage.getItem('__SB_TEST_DONT_SHOW_EMAIL_VERIFICATION_DIALOG')
    ) {
      dispatch(
        openDialog({ type: DialogType.EmailVerification, initData: { showExplanation: true } }),
      )
    }
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

export function logOut(spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson<void>(apiUrl`sessions`, {
      method: 'delete',
    })
    dispatch({ type: '@auth/logOut' })
    CREDENTIAL_STORAGE.store(undefined)
    clearSessionRefresh()
  })
}

export function signUp(
  {
    username,
    email,
    password,
    locale,
    signupCode,
  }: { username: string; email: string; password: string; locale?: string; signupCode?: string },
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
        signupCode: signupCode?.trim(),
      }),
    })
    window.fathom?.trackGoal('YTZ0JAUE', 0)

    dispatch(initSession(result, CredentialStorageType.Session, true /* wasSignup */))
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
    dispatch({ type: '@auth/sessionUnauthorized' })
    CREDENTIAL_STORAGE.store(undefined)
    clearSessionRefresh()
  }
}

export function recoverUsername(email: string, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`users/recovery/user`, {
      method: 'post',
      body: encodeBodyAsParams<RecoverUsernameRequest>({
        email,
      }),
    })
  })
}

export function requestPasswordReset(
  { username, email }: { username: string; email: string },
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`users/recovery/password`, {
      method: 'post',
      body: encodeBodyAsParams<RequestPasswordResetRequest>({
        username,
        email,
      }),
    })
  })
}

export function resetPassword(
  { code, password }: { code: string; password: string },
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`users/recovery/reset-password`, {
      method: 'post',
      body: encodeBodyAsParams<ResetPasswordRequest>({
        code,
        password,
      }),
    })
  })
}

export function verifyEmail(
  { userId, code }: { userId: SbUserId; code: string },
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson<void>(apiUrl`users/${userId}/email-verification`, {
      method: 'post',
      body: encodeBodyAsParams({ code }),
    })
    dispatch({
      type: '@auth/emailVerified',
    })
  })
}

export function sendVerificationEmail(userId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, () =>
    fetchJson<void>(apiUrl`users/${userId}/email-verification/send`, { method: 'post' }),
  )
}
