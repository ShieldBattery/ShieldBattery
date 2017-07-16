import httpErrors from 'http-errors'

export function featureEnabled(isEnabled) {
  return async function(ctx, next) {
    if (!isEnabled) {
      throw new httpErrors.NotFound()
    }

    await next()
  }
}
