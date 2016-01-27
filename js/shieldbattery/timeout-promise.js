export default function timeoutPromise(ms, promise, msg) {
  return new Promise((resolve, reject) => {
    promise.then(resolve, reject)
    setTimeout(() => reject(new Error(msg || 'Operation timed out')), ms)
  })
}
