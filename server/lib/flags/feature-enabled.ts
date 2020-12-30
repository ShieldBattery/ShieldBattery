import httpErrors from 'http-errors'
import { ExtendableContext, Next } from 'koa'

export function featureEnabled(isEnabled: boolean) {
  return async function (ctx: ExtendableContext, next: Next) {
    if (!isEnabled) {
      throw new httpErrors.NotFound()
    }

    await next()
  }
}
