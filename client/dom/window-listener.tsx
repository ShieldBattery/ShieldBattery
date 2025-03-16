import React, { useEffect } from 'react'

export interface WindowListenerProps {
  event: string
  listener: (event: Event) => void
}

/**
 * An animation-frame throttled event listener attached to the window, useful for things like
 * listening to resize events and adjusting state based on it (e.g. fixed position). Note that this
 * component assumes that its event and listener props will not change over its lifetime, and
 * ignores any changes to them.
 */
export default class WindowListener extends React.Component<WindowListenerProps> {
  private rafId: number | undefined
  private lastEvent: Event | undefined

  override componentDidMount() {
    window.addEventListener(this.props.event, this.eventHandler)
  }

  override componentWillUnmount() {
    window.removeEventListener(this.props.event, this.eventHandler)
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = undefined
    }
  }

  override render() {
    return null
  }

  private eventHandler = (event: Event) => {
    this.lastEvent = event
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(this.frameHandler)
    }
  }

  private frameHandler = () => {
    this.rafId = undefined
    this.props.listener(this.lastEvent!)
    this.lastEvent = undefined
  }
}

/**
 * A hook that attaches an animation-frame throttled event listener to the window, useful for things
 * like listening to resize events and adjusting state based on it (e.g. fixed position).
 */
export function useWindowListener<E extends string, T extends Event>(
  event: E,
  listener: (event: T) => void,
): void {
  useEffect(() => {
    let rafId: number | undefined
    let lastEvent: T | undefined

    const frameHandler = () => {
      rafId = undefined
      listener(lastEvent!)
      lastEvent = undefined
    }

    const eventHandler = (event: T) => {
      lastEvent = event
      if (!rafId) {
        requestAnimationFrame(frameHandler)
      }
    }

    window.addEventListener(event, eventHandler as any)

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      window.removeEventListener(event, eventHandler as any)
    }
  }, [event, listener])
}
