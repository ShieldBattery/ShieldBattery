import Koa from 'koa'

/**
 * A generic Error type that includes a `code` to identify what type of error it is.
 */
export class CodedError<CodeType extends string, DataType = any> extends Error {
  readonly data: DataType

  constructor(
    readonly code: CodeType,
    message: string,
    // NOTE(tec27): This complexity is to allow the options parameter to be optional, but only if
    // the data type for the code is undefined
    ...rest: undefined extends DataType
      ? [options?: { data?: DataType; cause?: unknown }]
      : [
          options: {
            data: DataType
            cause?: unknown
          },
        ]
  ) {
    const options = rest[0]
    super(message, options?.cause ? { cause: options?.cause } : undefined)
    this.data = options?.data as DataType
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
