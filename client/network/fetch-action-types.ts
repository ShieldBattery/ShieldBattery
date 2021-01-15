export class FetchError extends Error {
  constructor(message: string, readonly res: Response, readonly body?: { error: string }) {
    super(message)
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
