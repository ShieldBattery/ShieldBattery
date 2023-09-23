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

export type ValidatedRequestData<T extends JoiValidationDescriptor> = {
  params: ValidatedParamType<T>
  query: ValidatedQueryType<T>
  body: ValidatedBodyType<T>
}

/**
 * Validates a Koa request using Joi, returning typed values that have been normalized by Joi.
 *
 * POST and PATCH requests are using a convention where if they recieve a `jsonBody` field in a
 * request using "multipart/form-data" content type, it is assumed that it was JSON.stringified, so
 * we JSON.parse it here before validating its contents.
 */
export function validateRequest<T extends JoiValidationDescriptor>(
  ctx: RouterContext,
  { params, query, body }: T,
): ValidatedRequestData<T> {
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
    const reqMethodLowerCase = ctx.request.method.toLowerCase()
    let bodyToValidate = ctx.request.body
    if (
      (reqMethodLowerCase === 'post' || reqMethodLowerCase === 'patch') &&
      ctx.request.headers['content-type']?.toLocaleLowerCase().startsWith('multipart/form-data') &&
      bodyToValidate &&
      Object.hasOwn(bodyToValidate, 'jsonBody')
    ) {
      try {
        bodyToValidate = { ...bodyToValidate, jsonBody: JSON.parse(bodyToValidate.jsonBody) }
      } catch (err) {
        throw new httpErrors.BadRequest('The field `jsonBody` is not a valid JSON')
      }
    }
    const result = body.validate(bodyToValidate)
    if (result.error) {
      throw new httpErrors.BadRequest(`Invalid request body - ${result.error.message}`)
    }

    bodyResult = result.value
  }

  return { params: paramsResult!, query: queryResult!, body: bodyResult! }
}
