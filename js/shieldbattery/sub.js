function sub(emitter, event, cb) {
  var unsub = function() {
    emitter.removeListener(event, cb)
  }
  emitter.on(event, cb)
  return unsub
}

module.exports = sub
