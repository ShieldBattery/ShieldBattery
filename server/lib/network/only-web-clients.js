// Middleware wrapper that only runs it's wrapped function if the request is from a web client
// (i.e. not an Electron standalone client). Optionally you can also include a function that will
// run only for the Electron clients.
export default function (forWebClients, forElectronClients) {
  return function onlyWebClients(ctx, next) {
    if (!isElectronClient(ctx)) {
      return forWebClients(ctx, next)
    } else {
      return forElectronClients ? forElectronClients(ctx, next) : next()
    }
  }
}

export function isElectronClient(ctx) {
  const origin = ctx.get('Origin') || ''
  const hasClientHeader = !!ctx.get('X-Shield-Battery-Client')
  return origin.startsWith('shieldbattery://') && hasClientHeader
}
