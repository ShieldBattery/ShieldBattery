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
