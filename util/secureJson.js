// middleware that modifies JSON responses to be prefixed with AngularJS's expected prefix (so that
// its safe to send things like arrays to GET requests)
var jsonPrefix = ')]}\',\n'

module.exports = function secureJson(req, res, next) {
  function json(obj) {
    if (arguments.length == 2) {
      this.statusCode = obj
      obj = arguments[1]
    }

    var replacer = this.app.get('json replacer')
      , spaces = this.app.get('json spaces')
      , body = JSON.stringify(obj, replacer, spaces)

    if (!this.get('Content-Type')) this.set('Content-Type', 'application/json');

    return this.send(jsonPrefix + body)
  }

  res.json = json
  next()
}
