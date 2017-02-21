import httpErrors from 'http-errors'

async function middlewareFunc(throttle, getId, ctx, next) {
  const isLimited = await throttle.rateLimit(getId(ctx))
  if (isLimited) {
    throw new httpErrors.TooManyRequests()
  } else {
    await next()
  }
}

// Creates a new middleware function that will enforce request throttling using the specified
// throttle object (see ./create-throttle) and ID-retrieval method (which is a function(ctx)).
export default function throttleMiddleware(throttle, getId) {
  return middlewareFunc.bind(null, throttle, getId)
}
