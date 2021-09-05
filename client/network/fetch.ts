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

const DEFAULT_HEADERS: Record<string, string> = IS_ELECTRON
  ? {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shield-Battery-Client': 'true',
    }
  : {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

const defaults: RequestInit = {
  headers: DEFAULT_HEADERS,
  credentials: 'include',
}
export function fetchRaw(path: string, opts?: RequestInit): Promise<Response> {
  const serverUrl =
    path.startsWith('http:') || path.startsWith('https:') || path.startsWith('shieldbattery:')
      ? path
      : makeServerUrl(path)
  if (!opts) {
    return fetch(serverUrl, defaults)
  }

  // We generally want to merge headers with our defaults, so we have to do this explicitly
  const headers = {
    ...defaults.headers,
    ...opts.headers,
  }
  // If we're want to send content-type: multipart/form-data, let the fetch set content-type
  // by itself, so the form-data boundary gets set correctly.
  if (opts.body && FormData.prototype.isPrototypeOf(opts.body)) {
    delete (headers as Record<string, string>)['Content-Type']
  }

  return fetch(serverUrl, {
    ...defaults,
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

export default fetchJson
