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
  const currentCookieString = document.cookie || ''
  if (currentCookieString === lastCookieString) {
    return lastCookies
  }

  lastCookieString = currentCookieString
  lastCookies = {}
  const cookieArray = lastCookieString.split('; ')

  for (const cookie of cookieArray) {
    const index = cookie.indexOf('=')
    if (index < 0) { // ignore nameless cookies
      continue
    }

    const name = safeDecodeURIComponent(cookie.substring(0, index))
    // the first value that is seen for a cookie is the most
    // specific one.  values for the same cookie name that
    // follow are for less specific paths.
    if (lastCookies[name] === undefined) {
      lastCookies[name] = safeDecodeURIComponent(cookie.substring(index + 1))
    }
  }

  return lastCookies
}

export default readCookies
