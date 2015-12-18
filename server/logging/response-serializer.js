export default function serializeRes(res) {
  if (!res || !res.statusCode) return res

  const elapsed = typeof res._elapsed != 'undefined' ? res._elapsed : -1
  return {
    statusCode: res.statusCode,
    size: res.getHeader('Content-Length') || -1,
    elapsed,
    headers: {} // I don't really want to display response headers, but bunyan's CLI has
  }             // an erroneous check for headers or won't display statusCode
}
