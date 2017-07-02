// middleware that modifies JSON responses to be prefixed with AngularJS's expected prefix (so that
// its safe to send things like arrays to GET requests)
import isJson from 'koa-is-json'

const jsonPrefix = ")]}',\n"

export default function() {
  return async function secureJson(ctx, next) {
    await next()
    if (isJson(ctx.body)) {
      ctx.body = jsonPrefix + JSON.stringify(ctx.body)
    }
  }
}
