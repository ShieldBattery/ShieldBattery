// Read cookies into an object, caching the last value received.
let lastCookies = {}
let lastCookieString = ''

function safeDecodeURIComponent(str) {
  try {
    return decodeURIComponent(str)
  } catch (e) {
    return str
  }
}

function readCookies() {
  let currentCookieString = document.cookie || ''
  if (currentCookieString == lastCookieString) {
    return lastCookies
  }

  lastCookieString = currentCookieString
  lastCookies = {}
  let cookieArray = lastCookieString.split('; ')

  for (let cookie of cookieArray) {
    let index = cookie.indexOf('=')
    if (index < 0) { //ignore nameless cookies
      continue
    }

    let name = safeDecodeURIComponent(cookie.substring(0, index))
    // the first value that is seen for a cookie is the most
    // specific one.  values for the same cookie name that
    // follow are for less specific paths.
    if (lastCookies[name] === undefined) {
      lastCookies[name] = safeDecodeURIComponent(cookie.substring(index + 1))
    }
  }

  return lastCookies
}

module.exports = readCookies
