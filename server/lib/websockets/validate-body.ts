import errors from 'http-errors'
import { Map } from 'immutable'
import { RouteHandler } from 'nydus'

export default function validateBody(
  bodyValidators: Record<string, (value: unknown) => boolean>,
): RouteHandler {
  return async function (data: Map<string, any>, next) {
    const body = data.get('body') as Record<string, unknown> | undefined
    if (!body) throw new errors.BadRequest('invalid body')
    for (const key of Object.keys(bodyValidators)) {
      if (!bodyValidators[key](body[key])) {
        throw new errors.BadRequest(`Invalid ${key}`)
      }
    }

    return next(data)
  }
}
