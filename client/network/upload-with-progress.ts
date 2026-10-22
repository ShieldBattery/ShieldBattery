import { CREDENTIAL_STORAGE, UNAUTHORIZED_EMITTER } from './fetch'
import { FetchError, FetchNetworkError } from './fetch-errors'

/**
 * Posts a form to `url` the way `fetchJson` would (with the user's credentials, failing with a
 * `FetchError` or `FetchNetworkError`), calling `onProgress` with the fraction of the body sent so
 * far. `fetch` can't report how much of a request body has been sent, so this uses
 * `XMLHttpRequest`.
 */
export function postFormWithProgress<T>(
  url: string,
  body: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  const abortError = () =>
    signal?.reason instanceof Error
      ? signal.reason
      : new DOMException('The request was aborted', 'AbortError')

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')
    const token = CREDENTIAL_STORAGE.get()
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }

    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(xhr.responseText === '' ? undefined : JSON.parse(xhr.responseText))
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
        return
      }

      if (xhr.status === 401) {
        UNAUTHORIZED_EMITTER.emit('unauthorized', url)
      }
      reject(
        new FetchError(
          new Response(null, { status: xhr.status, statusText: xhr.statusText }),
          xhr.responseText,
        ),
      )
    }
    const onNetworkError = () => {
      reject(new FetchNetworkError(new TypeError('Network request failed')))
    }
    xhr.onerror = onNetworkError
    xhr.ontimeout = onNetworkError

    const onAbort = () => xhr.abort()
    xhr.onabort = () => {
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.onloadend = () => signal?.removeEventListener('abort', onAbort)

    xhr.send(body)
  })
}
