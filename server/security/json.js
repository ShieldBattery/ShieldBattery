// middleware that modifies JSON responses to be prefixed with AngularJS's expected prefix (so that
// its safe to send things like arrays to GET requests)
var isJson = require('koa-is-json')

var jsonPrefix = ')]}\',\n'

module.exports = function() {
  return function*(next) {
    yield next
    if (isJson(this.body)) {
      this.body = jsonPrefix + JSON.stringify(this.body)
    }
  }
}
