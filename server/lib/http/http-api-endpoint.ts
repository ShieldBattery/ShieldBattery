import { RouterContext } from '@koa/router'
import { Promisable } from 'type-fest'
import {
  JoiValidationDescriptor,
  ValidatedRequestData,
  validateRequest,
} from '../validation/joi-validator'

export type EndpointFunction<Result, T extends JoiValidationDescriptor> = (
  ctx: RouterContext,
  validatedRequestData: ValidatedRequestData<T>,
) => Promisable<Result>

/**
 * Returns a function that is suitable for using as the last function in a koa-router handler. The
 * function will be called with validated input data from the route/URL/body, and its return value
 * will be put in the response body.
 *
 * @param validationDescriptor A description of how to validate the request using Joi
 * @param endpointFunc A function that will be called with the validated data and used to derive a
 *   response
 *
 * @example
 * router.get('/:id', apiEndpoint(
    {
      params: Joi.object<{ id: number }>({
        id: Joi.number().min(1).required(),
      }),
    },
    async (ctx, { params }): Promise<{ user: User }> => {
      const user = await findUserById(params.id)
      if (!user) {
        throw new httpErrors.NotFound('user not found')
      }

      return { user }
    },
  )
 */
export function apiEndpoint<R, T extends JoiValidationDescriptor>(
  validationDescriptor: T,
  endpointFunc: EndpointFunction<R, T>,
) {
  return async (ctx: RouterContext) => {
    const validatedRequestData = validateRequest(ctx, validationDescriptor)
    const result = await endpointFunc(ctx, validatedRequestData)
    ctx.body = result
  }
}
