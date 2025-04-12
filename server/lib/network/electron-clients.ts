import Koa from 'koa'

export function isElectronClient(ctx: Koa.Context) {
  const origin = ctx.get('Origin') || ''
  return origin.startsWith('shieldbattery://')
}
