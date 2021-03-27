import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'

type SchemaOrUndefined<T> = T extends never ? undefined : Joi.ObjectSchema<T>

/** A description of how to validate a request. */
export interface JoiValidationDescriptor<P = never, Q = never, B = never> {
  /**
   * A schema to use for validating a request's named route parameters. If undefined, the params
   * will not be validated.
   */
  params?: SchemaOrUndefined<P>
  /**
   * A schema to use for validating a request's query string data. If undefined, the query string
   * will not be validated.
   */
  query?: SchemaOrUndefined<Q>
  /**
   * A schema to use for validating a request's body data. If undefined, the body will not be
   * validated.
   */
  body?: SchemaOrUndefined<B>
}

/** Returns a function that validates that the parts of a Koa request pass validation with Joi. */
export function joiValidator<P = never, Q = never, B = never>({
  params,
  query,
  body,
}: JoiValidationDescriptor<P, Q, B>) {
  return async (ctx: RouterContext, next: Koa.Next) => {
    if (params) {
      const { error } = params.validate(ctx.params)
      if (error) {
        throw new httpErrors.BadRequest(`Invalid params - ${error.message}`)
      }
    }
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

/** Validates a Koa request using Joi, returning typed values that have been normalized by Joi. */
export function validateRequest<P = any, Q = any, B = any>(
  ctx: RouterContext,
  { params, query, body }: JoiValidationDescriptor<P, Q, B>,
): { params: P; query: Q; body: B } {
  let paramsResult: P | undefined
  let queryResult: Q | undefined
  let bodyResult: B | undefined

  if (params) {
    const result = params.validate(ctx.params)
    if (result.error) {
      throw new httpErrors.BadRequest(`Invalid params - ${result.error.message}`)
    }

    paramsResult = result.value
  }
  if (query) {
    const result = query.validate(ctx.request.query)
    if (result.error) {
      throw new httpErrors.BadRequest(`Invalid query string - ${result.error.message}`)
    }

    queryResult = result.value
  }
  if (body) {
    const result = body.validate(ctx.request.body)
    if (result.error) {
      throw new httpErrors.BadRequest(`Invalid request body - ${result.error.message}`)
    }

    bodyResult = result.value
  }

  return { params: paramsResult!, query: queryResult!, body: bodyResult! }
}
