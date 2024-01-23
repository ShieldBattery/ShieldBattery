export default function rejectOnTimeout(
  promise: Promise<any>,
  ms: number,
  msg = 'Operation timed out',
) {
  let timerId: ReturnType<typeof setTimeout>
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
