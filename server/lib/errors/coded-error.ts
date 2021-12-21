import Koa from 'koa'

/**
 * A generic Error type that includes a `code` to identify what type of error it is.
 */
export class CodedError<CodeType extends string, DataType = any> extends Error {
  constructor(readonly code: CodeType, message: string, readonly data?: DataType) {
    super(message)
  }
}

/**
 * Returns a function that can be used as a middleware to convert any thrown errors to HttpErrors.
 * New errors should be thrown, unhandled errors can just be rethrown.
 */
export function makeErrorConverterMiddleware(errorConverter: (err: unknown) => void) {
  return async (_: any, next: Koa.Next) => {
    try {
      await next()
    } catch (err: unknown) {
      errorConverter(err)
    }
  }
}
