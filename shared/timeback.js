// Callbacks that automatically error out if they don't complete within a certain timeframe
export default function(timeoutMs, cb) {
  if (!timeoutMs) {
    return cb
  }

  let timeout
  const newCb = function() {
    if (!timeout) return
    clearTimeout(timeout)
    cb.apply(this, arguments)
  }

  timeout = setTimeout(() => {
    timeout = null
    const err = new Error('Timeout of ' + timeoutMs + 'ms exceeded')
    err.code = 'timeout'
    cb.call(this, err)
  }, timeoutMs)

  return newCb
}
