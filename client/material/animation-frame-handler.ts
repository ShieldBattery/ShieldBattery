import { UIEventHandler } from 'react'

/**
 * A set of functions for managing and using an event handler that is debounced to animation frames.
 */
interface AnimationFrameHandler<T> {
  /** An event handler that can be passed to components that fire a lot of events rapidly. */
  handler: UIEventHandler<T>
  /** Cancels any outstanding frame requests (e.g. when a component unmounts). */
  cancel: () => void
}

/**
 * Converts a function into one that is debounced to animation frames (via requestAnimationFrame).
 * Useful when you need to respond to events that fire often (such as scroll events).
 */
export function animationFrameHandler<T>(
  fn: (lastTarget: EventTarget | null) => void,
): AnimationFrameHandler<T> {
  let request: number | undefined
  let lastTarget: EventTarget | null = null

  const frameCallback = () => {
    request = undefined
    fn(lastTarget)
    lastTarget = null
  }

  const handler: UIEventHandler<T> = event => {
    lastTarget = event.target
    if (request) {
      return
    }

    request = requestAnimationFrame(frameCallback)
  }

  const cancel = () => {
    if (request) {
      cancelAnimationFrame(request)
      request = undefined
      lastTarget = null
    }
  }

  return { handler, cancel }
}
