var thenify = require('thenify')
  , lessMiddleware = require('less-middleware')

module.exports = function() {
  let less = thenify(lessMiddleware.apply(this, arguments))

  return function* compileLess(next) {
    yield less(this.req, this.res)
    yield next
  }
}
