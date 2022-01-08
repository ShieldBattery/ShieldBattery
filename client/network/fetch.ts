import { FetchError } from './fetch-errors'
import { makeServerUrl } from './server-url'

const fetch = window.fetch

// NOTE(tec27): I have no idea where to import this from otherwise lol
type RequestInit = NonNullable<Parameters<typeof fetch>[1]>

async function ensureSuccessStatus(res: Response): Promise<Response> {
  if (res.status >= 200 && res.status < 300) {
    return res
  } else {
    const text = await res.text()
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

export function fetchRaw(path: string, opts?: RequestInit): Promise<Response> {
  const serverUrl =
    path.startsWith('http:') || path.startsWith('https:') || path.startsWith('shieldbattery:')
      ? path
      : makeServerUrl(path)
  if (!opts) {
    return fetch(serverUrl, { credentials: 'include', headers: DEFAULT_HEADERS })
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

  return fetch(serverUrl, {
    credentials: 'include',
    ...opts,
    headers,
  })
}

export async function fetchJson<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await ensureSuccessStatus(await fetchRaw(path, opts))
  const text = await res.text()
  return parseResponseJson(text)
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
  return new URLSearchParams(body as unknown as Record<string, string>)
}
