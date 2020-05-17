import errors from 'http-errors'

export default function validateBody(bodyValidators) {
  return async function (data, next) {
    const body = data.get('body')
    if (!body) throw new errors.BadRequest('invalid body')
    for (const key of Object.keys(bodyValidators)) {
      if (!bodyValidators[key](body[key])) {
        throw new errors.BadRequest(`Invalid ${key}`)
      }
    }

    return next(data)
  }
}
