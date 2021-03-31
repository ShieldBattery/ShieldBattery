import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'

type ValidatedParamType<T> = T extends { params: Joi.ObjectSchema<infer U> } ? U : never
type ValidatedQueryType<T> = T extends { query: Joi.ObjectSchema<infer U> } ? U : never
type ValidatedBodyType<T> = T extends { body: Joi.ObjectSchema<infer U> } ? U : never

/** A description of how to validate a request. */
export interface JoiValidationDescriptor {
  /**
   * A schema to use for validating a request's named route parameters. If undefined, the params
   * will not be validated.
   */
  params?: Joi.ObjectSchema
  /**
   * A schema to use for validating a request's query string data. If undefined, the query string
   * will not be validated.
   */
  query?: Joi.ObjectSchema
  /**
   * A schema to use for validating a request's body data. If undefined, the body will not be
   * validated.
   */
  body?: Joi.ObjectSchema
}

/** Returns a function that validates that the parts of a Koa request pass validation with Joi. */
export function joiValidator({ params, query, body }: JoiValidationDescriptor) {
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
export function validateRequest<T extends JoiValidationDescriptor>(
  ctx: RouterContext,
  { params, query, body }: T,
): { params: ValidatedParamType<T>; query: ValidatedQueryType<T>; body: ValidatedBodyType<T> } {
  let paramsResult: ValidatedParamType<T> | undefined
  let queryResult: ValidatedQueryType<T> | undefined
  let bodyResult: ValidatedBodyType<T> | undefined

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
