import Koa from 'koa'
import httpErrors from 'http-errors'
import Joi from 'joi'

/** A description of how to validate a request. */
interface JoiValidationDescriptor {
  /**
   * A schema to use for validating a request's query string data. If undefined, the query string
   * will not be validated.
   */
  query?: Joi.Schema
  /**
   * A schema to use for validating a request's body data. If undefined, the body will not be
   * validated.
   */
  body?: Joi.Schema
}

/** Returns a function that validates that the parts of a Koa request pass validation with Joi. */
export function joiValidator({ query, body }: JoiValidationDescriptor) {
  return async (ctx: Koa.Context, next: Koa.Next) => {
    if (query) {
      const { error } = query.validate(ctx.request.query)
      if (error) {
        throw new httpErrors.BadRequest(`Invalid query string - ${error.message}`)
      }
    }
    if (body) {
      const { error } = body.validate(ctx.request.body)
      if (error) {
        throw new httpErrors.BadRequest(`Invalid request body - ${error.message}`)
      }
    }

    return next()
  }
}
