import isNetworkError from 'is-network-error'
import { assertUnreachable } from '../../common/assert-unreachable'
import { TypedEventEmitter } from '../../common/typed-emitter'
import { FetchError, FetchNetworkError } from './fetch-errors'
import { makeServerUrl } from './server-url'

const fetch = window.fetch

export type UnauthorizedEmitterEvents = {
  /** A request to `url` returned a 401 response. */
  unauthorized: (url: string) => void
}

export class UnauthorizedEmitter extends TypedEventEmitter<UnauthorizedEmitterEvents> {}

/** `EventEmitter` that emits events when a request returns a `401 Unauthorized` response. */
export const UNAUTHORIZED_EMITTER = new UnauthorizedEmitter()

export enum CredentialStorageType {
  Session,
  Local,
  /**
   * Select storage based on where credentials were previously stored. Defaults to Session if none
   * are stored.
   */
  Auto,
}

const BASE_CREDENTIAL_KEY = 'sbjwt'
// In Electron, if a different server is set than the default, save the key namespaced by that
// server so we don't end up with tokens that are signed for a different server when swapping
// between them
const CREDENTIAL_KEY =
  IS_ELECTRON && window.SHIELDBATTERY_ELECTRON_API?.env?.SB_SERVER
    ? `${BASE_CREDENTIAL_KEY}|${window.SHIELDBATTERY_ELECTRON_API.env.SB_SERVER}`
    : BASE_CREDENTIAL_KEY

export class CredentialStorage {
  get(): string | undefined {
    return (
      sessionStorage.getItem(CREDENTIAL_KEY) ?? localStorage.getItem(CREDENTIAL_KEY) ?? undefined
    )
  }

  store(token: string | undefined, storageType = CredentialStorageType.Auto): void {
    let storage = sessionStorage
    switch (storageType) {
      case CredentialStorageType.Session:
        storage = sessionStorage
        break
      case CredentialStorageType.Local:
        storage = localStorage
        break
      case CredentialStorageType.Auto: {
        if (sessionStorage.getItem(CREDENTIAL_KEY) || !localStorage.getItem(CREDENTIAL_KEY)) {
          storage = sessionStorage
        } else {
          storage = localStorage
        }
        break
      }
      default:
        storage = assertUnreachable(storageType)
    }

    // Ensure that if we had any other token in a different storage, it gets removed
    sessionStorage.removeItem(CREDENTIAL_KEY)
    localStorage.removeItem(CREDENTIAL_KEY)

    if (token) {
      storage.setItem(CREDENTIAL_KEY, token)
    }
  }
}

/**
 * Storage for authorization tokens. Should be set whenever a new user auths and cleared when they
 * log out.
 */
export const CREDENTIAL_STORAGE = new CredentialStorage()

// NOTE(tec27): I have no idea where to import this from otherwise lol
type RequestInit = NonNullable<Parameters<typeof fetch>[1]>

async function ensureSuccessStatus(res: Response): Promise<Response> {
  if (res.status >= 200 && res.status < 300) {
    return res
  } else {
    const text = await res.text()

    if (res.status === 401) {
      UNAUTHORIZED_EMITTER.emit('unauthorized', res.url)
    }

    throw new FetchError(res, text)
  }
}

/**
 * Parses the response JSON, allowing for an empty string (since these can be valid responses for
 * e.g. a 204).
 */
function parseResponseJson(str: string) {
  if (str === '') return undefined
  return JSON.parse(str)
}

type HeadersInit = NonNullable<Parameters<typeof fetch>[1]>['headers']

const DEFAULT_HEADERS: HeadersInit = {
  Accept: 'application/json',
}

function handleNetworkErrors(err: unknown): any {
  if (isNetworkError(err)) {
    throw new FetchNetworkError(err)
  } else {
    throw err
  }
}

function doFetch(url: string, opts: RequestInit): Promise<Response> {
  if (opts.credentials === 'include') {
    // Add the JWT to the request if we have one
    const token = CREDENTIAL_STORAGE.get()
    let withCredentials = opts
    if (token) {
      withCredentials = { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } }
    }
    return fetch(url, withCredentials).catch(handleNetworkErrors)
  } else {
    return fetch(url, opts).catch(handleNetworkErrors)
  }
}

export function fetchRaw(path: string, opts?: RequestInit): Promise<Response> {
  const serverUrl =
    path.startsWith('http:') || path.startsWith('https:') || path.startsWith('shieldbattery:')
      ? path
      : makeServerUrl(path)
  if (!opts) {
    return doFetch(serverUrl, { credentials: 'include', headers: DEFAULT_HEADERS })
  }

  // We generally want to merge headers with our defaults, so we have to do this explicitly
  const headers: HeadersInit = {
    ...DEFAULT_HEADERS,
    ...opts.headers,
  }
  if (opts.body) {
    if (typeof opts.body === 'string') {
      // If we're sending a string body, assume this is already-encoded JSON. We only want to set
      // this header in this particular case, because setting it even with empty bodies will trigger
      // a CORS preflight request
      ;(headers as Record<string, string>)['Content-Type'] = 'application/json'
    }
  }

  return doFetch(serverUrl, {
    credentials: 'include',
    ...opts,
    headers,
  })
}

export async function fetchJson<T>(path: string, opts?: RequestInit): Promise<T> {
  try {
    const res = await ensureSuccessStatus(await fetchRaw(path, opts))
    const text = await res.text()
    return parseResponseJson(text)
  } catch (err) {
    return await handleNetworkErrors(err)
  }
}

type SearchParamsValues = string | number | boolean | null | undefined | Date
// NOTE(tec27): We do this directly rather than using Record because Record<keyof T, ...> will
// make the properties required (that is, remove optionalality). Good explanation with examples
// here: https://stackoverflow.com/a/56140392
type ValidSearchParams<T> = {
  [K in keyof T]: SearchParamsValues
}

/**
 * Encodes an object as a URLSearchParams. For this to properly, the object must only contain values
 * that can be stringified (so no nested objects, no functions, etc). For POST requests, this is a
 * preferable format over JSON, as it does not need to be pre-flighted for CORS.
 */
export function encodeBodyAsParams<BodyType extends ValidSearchParams<BodyType>>(
  body: BodyType,
): URLSearchParams {
  const params = Object.entries(body)
  return new URLSearchParams(
    // Remove any undefined/null values since they get converted to strings
    params.filter(([, value]) => value !== undefined && value !== null) as string[][],
  )
}
