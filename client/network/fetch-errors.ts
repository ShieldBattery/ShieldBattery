import { getErrorStack } from '../../common/errors'

export class FetchError extends Error {
  readonly status: number
  readonly statusText: string
  readonly url: string

  private _parsedBody: unknown

  constructor(
    res: Response,
    private bodyText: string,
  ) {
    super(res.statusText)
    this.status = res.status
    this.statusText = res.statusText
    this.url = res.url
  }

  get body(): unknown {
    if (this._parsedBody) {
      return this._parsedBody
    }

    if (this.bodyText === '') {
      this._parsedBody = undefined
      return this._parsedBody
    }

    try {
      this._parsedBody = JSON.parse(this.bodyText)
    } catch (err) {
      this._parsedBody = undefined
    }

    return this._parsedBody
  }

  /**
   * Returns the error code this error was sent with, if any. This will correspond to the `code`
   * field on a `CodedError` if it is thrown as an `HttpError`.
   */
  get code(): string | undefined {
    const body = this.body

    if (
      body &&
      typeof body === 'object' &&
      'code' in body &&
      typeof (body as any).code === 'string'
    ) {
      return (body as any).code
    }

    return undefined
  }

  override toString(): string {
    return `${this.url} returned ${this.status}: ${this.statusText}`
  }
}

export function isFetchError(err: unknown): err is FetchError {
  return err instanceof FetchError
}

/**
 * A network error (such as a malformed response, early termination, timeout, etc.) occurred.
 * Unfortunately we get very little information about what *kind* of problem happened.
 */
export class FetchNetworkError extends Error {
  constructor(cause: TypeError) {
    super(`Network error occurred`, { cause })
  }
}

export function isFetchNetworkError(err: unknown): err is FetchNetworkError {
  return err instanceof FetchNetworkError
}

/**
 * Describes a failed request for a log line: the URL and status for a response the server sent,
 * the underlying cause for a request that never completed, and the stack for anything else. A
 * `FetchError`'s own stack only names its status text, which says nothing about which request
 * failed or why.
 */
export function describeFetchError(err: unknown): string {
  if (isFetchError(err)) {
    const code = err.code
    return `${err.toString()}${code ? ` (code: ${code})` : ''}`
  } else if (isFetchNetworkError(err)) {
    const cause = err.cause instanceof Error ? err.cause.message : String(err.cause)
    return `${err.message}: ${cause}`
  } else {
    return getErrorStack(err) ?? String(err)
  }
}

/**
 * A base action type for fetch requests that fail. Most of these should probably add a `meta`
 * field with more info about what the request actually was.
 */
export interface BaseFetchFailure<T extends string> {
  type: T
  error: true
  payload: FetchError
}
