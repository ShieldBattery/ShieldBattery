// middleware wrapper that only runs it's wrapped function if the request is from a web client
// (i.e. not an Electron standalone client)
export default function (wrapped) {
  return function onlyWebClients(ctx, next) {
    if (
      ctx.req.headers.origin !== 'http://client.shieldbattery.net' ||
      !ctx.req.headers['x-shield-battery-client']
    ) {
      return wrapped(ctx, next)
    } else {
      return next()
    }
  }
}
