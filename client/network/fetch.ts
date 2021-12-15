import { Readable } from 'stream'
import 'whatwg-fetch'
import { FetchError } from './fetch-action-types'
import { makeServerUrl } from './server-url'

const fetch = window.fetch

// NOTE(tec27): I have no idea where to import this from otherwise lol
type RequestInit = NonNullable<Parameters<typeof fetch>[1]>

function ensureSuccessStatus(res: Response): Response {
  if (res.status >= 200 && res.status < 300) {
    return res
  } else {
    throw new FetchError(`${res.url} got ${res.status}: ${res.statusText}`, res)
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
  try {
    const res = ensureSuccessStatus(await fetchRaw(path, opts))
    const text = await res.text()
    return parseResponseJson(text)
  } catch (err: any) {
    if (!err.res) throw err

    const res: Response = err.res

    try {
      const text = await res.text()
      const parsed = parseResponseJson(text)
      err.body = parsed
    } catch (_) {
      err.body = { error: err.message }
    }

    throw err
  }
}

type StreamReader = ReturnType<typeof ReadableStream.prototype.getReader>

// Wraps the whatwg ReadableStream to be a Node ReadableStream
class BrowserReadableStreamWrapper extends Readable {
  private readerPromise: Promise<StreamReader>
  private reading = false

  constructor(fetchPromise: Promise<Response>) {
    super()
    this.readerPromise = fetchPromise.then(res => res.body!.getReader())

    fetchPromise.catch(this.emitError)
  }

  override _read() {
    if (this.reading) {
      return
    }

    this.reading = true
    this.doRead()
  }

  private doRead() {
    this.readerPromise
      .then(reader => reader.read())
      .then(({ value, done }) => {
        if (done) {
          this.push(null)
          this.reading = false
          return
        }

        const keepGoing = this.push(Buffer.from(value.buffer))
        if (keepGoing) {
          this.doRead()
        } else {
          this.reading = false
        }
      }, this.emitError)
  }

  private emitError = (err: Error) => {
    this.emit('error', err)
  }
}

// Returns a Node ReadableStream for data from the response of the request. This should only be used
// in Electron, as the necessary fetch API is not supported in all browsers we support yet (and not
// polyfilled with our polyfill)
export function fetchReadableStream(path: string, opts?: RequestInit) {
  if (!IS_ELECTRON) {
    throw new Error('Reading a stream is not supported in browsers yet')
  }

  const fetchPromise = fetchRaw(path, opts).then(ensureSuccessStatus)
  return new BrowserReadableStreamWrapper(fetchPromise)
}

type SearchParamsValues = string | number | boolean | null | undefined | Date
type ValidSearchParams<T> = Record<keyof T, SearchParamsValues>

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
