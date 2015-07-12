// middleware that modifies JSON responses to be prefixed with AngularJS's expected prefix (so that
// its safe to send things like arrays to GET requests)
import isJson from 'koa-is-json'

const jsonPrefix = ')]}\',\n'

export default function() {
  return function* secureJson(next) {
    yield next
    if (isJson(this.body)) {
      this.body = jsonPrefix + JSON.stringify(this.body)
    }
  }
}
