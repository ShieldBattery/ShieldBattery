export default function rejectOnTimeout(promise, ms, msg = 'Operation timed out') {
  let timerId
  return new Promise((resolve, reject) => {
    timerId = setTimeout(() => reject(new Error(msg)), ms)
    promise.then(
      val => {
        resolve(val)
        clearTimeout(timerId)
      },
      err => {
        reject(err)
        clearTimeout(timerId)
      },
    )
  })
}
