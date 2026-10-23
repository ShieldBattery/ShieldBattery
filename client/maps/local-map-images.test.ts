import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { LocalMapImageScheduler, ReleaseLocalMapImage } from './local-map-images'

/** An observer whose targets' visibility the test sets with `setVisible`. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly targets = new Set<Element>()

  constructor(private callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target: Element) {
    this.targets.add(target)
  }

  unobserve(target: Element) {
    this.targets.delete(target)
  }

  disconnect() {
    this.targets.clear()
  }
}

function setVisible(elements: Element[], isIntersecting: boolean) {
  for (const observer of FakeIntersectionObserver.instances) {
    const entries = elements
      .filter(e => observer.targets.has(e))
      .map(target => ({ target, isIntersecting }) as IntersectionObserverEntry)
    if (entries.length) {
      ;(observer as any).callback(entries, observer)
    }
  }
}

describe('client/maps/local-map-images', () => {
  let savedIntersectionObserver: unknown
  let container: HTMLElement
  let scheduler: LocalMapImageScheduler
  let granted: string[]
  let releases: Map<string, ReleaseLocalMapImage>

  beforeEach(() => {
    savedIntersectionObserver = (globalThis as any).IntersectionObserver
    ;(globalThis as any).IntersectionObserver = FakeIntersectionObserver
    FakeIntersectionObserver.instances = []
    container = document.createElement('div')
    document.body.append(container)
    scheduler = new LocalMapImageScheduler()
    granted = []
    releases = new Map()
  })

  afterEach(() => {
    ;(globalThis as any).IntersectionObserver = savedIntersectionObserver
    container.remove()
  })

  function addTiles(hashes: string[]): Element[] {
    return hashes.map(hash => {
      const element = document.createElement('div')
      container.append(element)
      scheduler.register(element, hash, release => {
        granted.push(hash)
        releases.set(hash, release)
      })
      return element
    })
  }

  test('loads visible tiles in layout order, a couple at a time', () => {
    const tiles = addTiles(['a', 'b', 'c', 'd'])
    // Visibility is reported in a different order than the tiles are laid out in
    setVisible([tiles[3], tiles[1], tiles[2], tiles[0]], true)
    expect(granted).toEqual(['a', 'b'])

    releases.get('a')!(true)
    expect(granted).toEqual(['a', 'b', 'c'])
    releases.get('b')!(true)
    releases.get('c')!(true)
    expect(granted).toEqual(['a', 'b', 'c', 'd'])
  })

  test("skips tiles that left the screen before their turn, and doesn't double-release", () => {
    const tiles = addTiles(['a', 'b', 'c', 'd', 'e'])
    setVisible(tiles.slice(0, 4), true)
    setVisible([tiles[2], tiles[3]], false)
    setVisible([tiles[4]], true)

    releases.get('a')!(true)
    releases.get('a')!(true)
    expect(granted).toEqual(['a', 'b', 'e'])

    setVisible([tiles[2]], true)
    expect(granted).toEqual(['a', 'b', 'e'])
    releases.get('b')!(false)
    expect(granted).toEqual(['a', 'b', 'e', 'c'])
  })

  test('grants images that already loaded without waiting for a slot', () => {
    const [a, b, c] = addTiles(['a', 'b', 'c'])
    setVisible([a, b, c], true)
    releases.get('a')!(true)
    expect(granted).toEqual(['a', 'b', 'c'])

    // `b` and `c` hold both slots; a second tile showing `a` loads it from the cache
    const [again] = addTiles(['a'])
    setVisible([again], true)
    expect(granted).toEqual(['a', 'b', 'c', 'a'])
  })

  test('never grants a tile that stopped waiting', () => {
    const element = document.createElement('div')
    container.append(element)
    const unregister = scheduler.register(element, 'a', () => granted.push('a'))
    unregister()
    setVisible([element], true)
    expect(granted).toEqual([])
  })
})
