// Deferred are thenables that are meant to be resolved externally, through #resolve and #reject
// methods on the Deferred object. This is useful for cases where you want to pass a promise to
// something for waiting on, but its resolution doesn't directly map to another async function.
//
// This explicitly doesn't extend Promise because it causes problems in browsers when using the
// babel polyfill (Prototype doesn't end up with the Deferred-specific methods on it)
class Deferred {
  constructor(promise, resolve, reject) {
    this._promise = promise
    this._resolve = resolve
    this._reject = reject
  }

  resolve(value) {
    this._resolve(value)
  }

  reject(err) {
    this._reject(err)
  }

  then(...args) {
    return this._promise.then(...args)
  }

  catch(...args) {
    return this._promise.catch(...args)
  }
}

export default function createDeferred() {
  let _resolve, _reject
  const promise = new Promise((resolve, reject) => {
    // This executes *immediately* (before the stuff later on in the outer function)
    _resolve = resolve
    _reject = reject
  })
  return new Deferred(promise, _resolve, _reject)
}
