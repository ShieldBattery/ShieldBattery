export class FetchError extends Error {
  readonly status: number
  readonly statusText: string
  readonly url: string

  private _parsedBody: unknown

  constructor(res: Response, private bodyText: string) {
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
 * A base action type for fetch requests that fail. Most of these should probably add a `meta`
 * field with more info about what the request actually was.
 */
export interface BaseFetchFailure<T extends string> {
  type: T
  error: true
  payload: FetchError
}
