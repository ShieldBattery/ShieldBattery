import { RefObject, useEffect, useRef, useState } from 'react'
import { localMapImageUrl } from '../../common/map-library'

/**
 * How many local map images may be loading at once. The app renders one map at a time, so a second
 * request keeps it busy while the first one's image travels back.
 */
const MAX_LOADING = 2

/** Ends a granted image load, freeing its slot. `loaded` says whether the image loaded. */
export type ReleaseLocalMapImage = (loaded: boolean) => void

interface Waiter {
  element: Element
  hash: string
  visible: boolean
  onGrant: (release: ReleaseLocalMapImage) => void
}

/**
 * Decides when each tile may load its local map image. An image that isn't cached yet is rendered by
 * the app, which takes a while per map, so tiles load only while they're on screen, a few at a time,
 * in the order they're laid out. Tiles scrolled past before their turn never ask for an image, and
 * images this session has already loaded come straight from the cache, without waiting their turn.
 */
export class LocalMapImageScheduler {
  private readonly waiters = new Map<Element, Waiter>()
  private readonly loaded = new Set<string>()
  private loading = 0
  private observer: IntersectionObserver | undefined

  /**
   * Waits for `element` to be on screen and a slot to free up, then calls `onGrant` with the function
   * that ends the load. Returns a function that stops waiting.
   */
  register(
    element: Element,
    hash: string,
    onGrant: (release: ReleaseLocalMapImage) => void,
  ): () => void {
    this.waiters.set(element, { element, hash, visible: false, onGrant })
    this.getObserver().observe(element)
    return () => {
      if (this.waiters.get(element)?.onGrant === onGrant) {
        this.waiters.delete(element)
        this.observer?.unobserve(element)
      }
    }
  }

  private getObserver(): IntersectionObserver {
    this.observer ??= new IntersectionObserver(entries => {
      for (const entry of entries) {
        const waiter = this.waiters.get(entry.target)
        if (waiter) {
          waiter.visible = entry.isIntersecting
        }
      }
      this.pump()
    })
    return this.observer
  }

  private pump(): void {
    const visible = Array.from(this.waiters.values()).filter(w => w.visible)
    for (const waiter of visible) {
      if (this.loaded.has(waiter.hash)) {
        this.grant(waiter, false)
      }
    }

    if (this.loading >= MAX_LOADING) {
      return
    }
    const next = visible
      .filter(w => this.waiters.has(w.element))
      .sort((a, b) =>
        a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
    for (const waiter of next.slice(0, MAX_LOADING - this.loading)) {
      this.grant(waiter, true)
    }
  }

  private grant(waiter: Waiter, takesSlot: boolean): void {
    this.waiters.delete(waiter.element)
    this.observer?.unobserve(waiter.element)
    if (takesSlot) {
      this.loading++
    }

    let released = false
    waiter.onGrant(loaded => {
      if (released) {
        return
      }
      released = true
      if (loaded) {
        this.loaded.add(waiter.hash)
      }
      if (takesSlot) {
        this.loading--
        this.pump()
      }
    })
  }
}

const scheduler = new LocalMapImageScheduler()

/**
 * The image URL of the local map file with `hash`, once the tile at `elementRef` may load it (see
 * `LocalMapImageScheduler`), and the function to call when the image loads or fails.
 */
export function useLocalMapImage(
  hash: string | undefined,
  elementRef: RefObject<Element | null>,
): { src: string | undefined; onSettled: ReleaseLocalMapImage } {
  const [grantedHash, setGrantedHash] = useState<string>()
  const releaseRef = useRef<ReleaseLocalMapImage>(undefined)

  useEffect(() => {
    const element = elementRef.current
    if (!hash || !element) {
      return undefined
    }
    const unregister = scheduler.register(element, hash, release => {
      releaseRef.current = release
      setGrantedHash(hash)
    })
    return () => {
      unregister()
      releaseRef.current?.(false)
      releaseRef.current = undefined
    }
  }, [hash, elementRef])

  return {
    src: hash && grantedHash === hash ? localMapImageUrl(hash) : undefined,
    onSettled: loaded => {
      releaseRef.current?.(loaded)
      releaseRef.current = undefined
    },
  }
}
