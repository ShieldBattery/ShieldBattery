type ResolveFn<T> = (value: T | PromiseLike<T>) => void
type RejectFn = (reason?: any) => void

const PRIVATE_TOKEN = Symbol('DEFERRED_PRIVATE_TOKEN')

/**
 * A thenable that is meant to be resolved externally, through #resolve and #reject
 * methods on the Deferred object. This is useful for cases where you want to pass a promise to
 * something for waiting on, but its resolution doesn't directly map to another async function.
 *
 * This explicitly doesn't extend Promise because it causes problems in browsers when using the
 * babel polyfill (Prototype doesn't end up with the Deferred-specific methods on it)
 */
export class Deferred<T> {
  /**
   * Constructs a new Deferred. Don't call this directly, use `createDeferred` instead.
   */
  constructor(
    private _promise: Promise<T>,
    private _resolve: ResolveFn<T>,
    private _reject: RejectFn,
    privateToken: typeof PRIVATE_TOKEN,
  ) {
    if (!privateToken) {
      throw new Error('Deferreds should be constructed using createDeferred')
    }
  }

  resolve(value: T | PromiseLike<T>) {
    this._resolve(value)
  }

  reject(reason?: any) {
    this._reject(reason)
  }

  /**
   * Attaches callbacks for the resolution and/or rejection of the Promise.
   * @param onfulfilled The callback to execute when the Promise is resolved.
   * @param onrejected The callback to execute when the Promise is rejected.
   * @returns A Promise for the completion of which ever callback is executed.
   */
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected)
  }

  /**
   * Attaches a callback for only the rejection of the Promise.
   * @param onrejected The callback to execute when the Promise is rejected.
   * @returns A Promise for the completion of the callback.
   */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<T | TResult> {
    return this._promise.catch(onrejected)
  }

  /**
   * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
   * resolved value cannot be modified from the callback.
   * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
   * @returns A Promise for the completion of the callback.
   */
  finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this._promise.finally(onfinally)
  }
}

const noop = () => {}

export default function createDeferred<T>() {
  // NOTE(tec27): The value here is just to make the compiler happy, these will always be assigned
  // before use
  let _resolve: ResolveFn<T> = noop
  let _reject: RejectFn = noop
  const promise = new Promise<T>((resolve, reject) => {
    // This executes *immediately* (before the stuff later on in the outer function)
    _resolve = resolve
    _reject = reject
  })
  return new Deferred(promise, _resolve, _reject, PRIVATE_TOKEN)
}
