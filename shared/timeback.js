// Callbacks that automatically error out if they don't complete within a certain timeframe
module.exports = function(timeoutMs, cb) {
  if (!timeoutMs) {
    return cb
  }

  var timeout
  var newCb = function() {
    if (!timeout) return
    clearTimeout(timeout)
    cb.apply(this, arguments)
  }

  var context = this
  timeout = setTimeout(function() {
    timeout = null
    var err = new Error('Timeout of ' + timeoutMs + 'ms exceeded')
    err.code = 'timeout'
    cb.call(context, err)
  }, timeoutMs)

  return newCb
}
