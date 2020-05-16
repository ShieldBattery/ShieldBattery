// Creates a promise that will resolve when a stream ends, or reject if it emits an error. Use with
// streams that are readable.
export function streamEndPromise(stream) {
  return new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject))
}

// Creates a promise that will resolve when a stream finishes, or reject if it emits an error. Use
// with streams that are writable.
export function streamFinishPromise(stream) {
  return new Promise((resolve, reject) => stream.on('finish', resolve).on('error', reject))
}
