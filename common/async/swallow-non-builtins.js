/**
 * A function intended to be a rejection handler for promises that will swallow any errors that
 * aren't of a built-in type (e.g. SyntaxError). This is useful when you'd like to silence unhandled
 * rejections for a particular promise, but still allow programmer errors through.
 */
export default function swallowNonBuiltins(err) {
  if (
    err instanceof SyntaxError ||
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    err instanceof RangeError
  ) {
    throw err
  }
}
