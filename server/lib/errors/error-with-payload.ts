/**
 * A custom Error type meant to be returned from API methods that can include a payload for the
 * response body.
 *
 * @example
 * throw new HttpErrorWithPayload(409, 'user already exists', { code: 'USER_ALREADY_EXISTS' })
 */
export class HttpErrorWithPayload<T = unknown> extends Error {
  status: number
  expose = true

  constructor(public statusCode: number, message: string, public payload: T) {
    super(message)
    this.status = statusCode

    Object.defineProperty(this, 'name', {
      enumerable: false,
      configurable: true,
      value: this.constructor.name,
      writable: true,
    })
  }
}

/**
 * A helper function which makes throwing HTTP errors with error code a bit easier to use.
 *
 * @param {number} statusCode HTTP error code
 * @param {string }} error The error to be thrown with a custom `code` that will be included in the
 *  payload
 */
export function asHttpError(statusCode: number, error: Error & { code: string; data?: any }) {
  return new HttpErrorWithPayload(statusCode, error.message, { code: error.code, ...error.data })
}
