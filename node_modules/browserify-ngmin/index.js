var ngmin = require('ngmin')
  , through = require('through')

module.exports = function() {
  var buffered = ''

  function write(data) {
    buffered += data
  }

  function end() {
    var annotated
    try {
      annotated = ngmin.annotate(buffered)
    } catch (err) {
      this.emit('error', err)
    }

    this.queue(annotated)
    this.queue(null)
  }

  return through(write, end)
}
