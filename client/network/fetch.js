import 'whatwg-fetch'
import { Readable } from 'stream'
import { makeServerUrl } from './server-url'
import readCookies from './read-cookies'

const fetch = window.fetch

function ensureSuccessStatus(res) {
  if (res.status >= 200 && res.status < 300) {
    return res
  } else {
    const err = new Error(res.statusText)
    err.res = res
    throw err
  }
}

const JSON_PREFIX = /^\)\]\}',?\n/
function parsePrefixedJson(str) {
  if (str === '') return null

  const replaced = str.replace(JSON_PREFIX, '')
  return JSON.parse(replaced)
}

const defaults = {
  get headers() {
    return process.webpackEnv.SB_ENV === 'web' ? {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-XSRF-TOKEN': readCookies()['XSRF-TOKEN'],
    } : {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shield-Battery-Client': 'true',
    }
  },
  credentials: 'same-origin'
}
export function fetchRaw(path, opts) {
  const serverUrl = path.startsWith('http') ? path : makeServerUrl(path)
  if (!opts) {
    const compiledOpts = path !== serverUrl ? {
      ...defaults,
      // Include credentials for non-web clients because everything is cross-origin
      credentials: 'include',
    } : defaults
    return fetch(serverUrl, compiledOpts)
  }

  // We generally want to merge headers with our defaults, so we have to do this explicitly
  const headers = {
    ...defaults.headers,
    ...opts.headers,
  }
  // If we're want to send content-type: multipart/form-data, let the fetch set content-type
  // by itself, so the form-data boundary gets set correctly.
  if (opts.body && FormData.prototype.isPrototypeOf(opts.body)) {
    delete headers['Content-Type']
  }

  const credentials = path !== serverUrl ? {
      // Include credentials for non-web clients because everything is cross-origin
    credentials: 'include',
  } : null

  return fetch(serverUrl, {
    ...defaults,
    ...credentials,
    ...opts,
    headers,
  })
}

export function fetchJson(path, opts) {
  return (fetchRaw(path, opts)
    .then(ensureSuccessStatus)
    .then(res => res.text())
    .then(parsePrefixedJson)
    .catch(err => {
      if (!err.res) throw err

      // Make a best effort to parse the error body as JSON
      return (err.res.text()
        .then(parsePrefixedJson)
        .then(errJson => {
          err.body = errJson
          throw err
        }, () => {
          err.body = { error: err.message }
          throw err
        }))
    }))
}

// Wraps the whatwg ReadableStream to be a Node ReadableStream
class BrowserReadableStreamWrapper extends Readable {
  constructor(fetchPromise) {
    super()
    this._readerPromise = fetchPromise.then(res => res.body.getReader(), this._emitError)
    this._reading = false
  }

  _read() {
    if (this._reading) {
      return
    }

    this._reading = true
    this._doRead()
  }

  _doRead() {
    this._readerPromise
      .then(reader => reader.read())
      .then(({ value, done }) => {
        if (done) {
          this.push(null)
          this._reading = false
          return
        }

        const keepGoing = this.push(Buffer.from(value.buffer))
        if (keepGoing) {
          this._doRead()
        } else {
          this._reading = false
        }
      }, this._emitError)
  }

  _emitError = err => {
    this.emit('error', err)
  }
}

// Returns a Node ReadableStream for data from the response of the request. This should only be used
// in Electron, as the necessary fetch API is not supported in all browsers we support yet (and not
// polyfilled with our polyfill)
export function fetchReadableStream(path, opts) {
  const fetchPromise = fetchRaw(path, opts).then(ensureSuccessStatus)
  return new BrowserReadableStreamWrapper(fetchPromise)
}

export default fetchJson
