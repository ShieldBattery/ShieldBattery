import 'whatwg-fetch'
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

export default fetchJson
