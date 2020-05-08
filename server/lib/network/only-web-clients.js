// middleware wrapper that only runs it's wrapped function if the request is from a web client
// (i.e. not an Electron standalone client)
export default function (wrapped) {
  return function onlyWebClients(ctx, next) {
    const origin = ctx.get('Origin') || ''
    const hasClientHeader = !!ctx.get('X-Shield-Battery-Client')
    if (!origin.startsWith('shieldbattery://') || !hasClientHeader) {
      return wrapped(ctx, next)
    } else {
      return next()
    }
  }
}
