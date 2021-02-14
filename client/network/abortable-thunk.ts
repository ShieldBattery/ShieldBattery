import { ReduxAction } from '../action-types'
import { DispatchFunction, ThunkAction } from '../dispatch-registry'
import { RootState } from '../root-reducer'

/**
 * Configures the handling of a particular request, allowing a caller to be notified when it is
 * completed or fails, and optionally allowing the request to be canceled via an `AbortController`.
 */
export interface RequestHandlingSpec {
  /**
   * An optional signal to be used to detect if the request was canceled. Canceled requests will not
   * call through to `onSuccess` or `onError`. This signal should be the same one passed to any
   * cancelable APIs (e.g. `fetch`) that are called by the underlying request code.
   */
  signal?: AbortSignal
  /**
   * A function that will be called if the underlying request succeeds.
   */
  onSuccess: () => void
  /**
   * A function that will be called if the underlying request fails (not including failures due
   * to `AbortError`s).
   */
  onError: (err: Error) => void
}

/**
 * A helper to create a Redux Thunk that can be aborted mid-flight, and will pass its errors back
 * to the calling code. This is useful if you would like to request data in response to some user
 * action (e.g. navigation), but want to handle errors directly instead of passing them through
 * Redux.
 *
 * @example
 * function requestData(dataId: number, spec: RequestHandlingSpec): ThunkAction {
 *  return abortableThunk(spec, async dispatch => {
 *    dispatch({
 *      type: '@data/request',
 *      // NOTE(tec27): The `await` here is important, it means only successful
 *      // responses will be dispatched
 *      payload: await fetch<RequestPayload>(apiUrl`data/${dataId}`, {
 *        signal: spec.signal,
 *      }),
 *    })
 *  })
 * }
 */
export function abortableThunk<T extends ReduxAction>(
  { signal, onSuccess, onError }: RequestHandlingSpec,
  thunkFn: (dispatch: DispatchFunction<T>, getState: () => RootState) => Promise<void>,
): ThunkAction<T> {
  return (dispatch, getState) => {
    thunkFn(dispatch, getState)
      .then(() => {
        if (signal?.aborted) {
          return
        }

        onSuccess()
      })
      .catch((err: Error) => {
        if (signal?.aborted || (signal && err.name === 'AbortError')) {
          return
        }

        onError(err)
      })
  }
}
