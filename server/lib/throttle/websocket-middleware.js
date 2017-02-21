import httpErrors from 'http-errors'

async function middlewareFunc(throttle, getId, data, next) {
  const isLimited = await throttle.rateLimit(getId(data))
  if (isLimited) {
    throw new httpErrors.TooManyRequests()
  } else {
    return next(data)
  }
}

// Creates a new nydus middleware function that will enforce request throttling using the specified
// throttle object (see ./create-throttle) and ID-retrieval method (which is a function(data)).
export default function throttleMiddleware(throttle, getId) {
  return middlewareFunc.bind(null, throttle, getId)
}
