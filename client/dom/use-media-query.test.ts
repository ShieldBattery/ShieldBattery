import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useMediaQuery } from './use-media-query'

/** A minimal fake `MediaQueryList` that records its `change` listeners so a test can fire them. */
function makeFakeMediaQueryList(initialMatches: boolean) {
  const listeners = new Set<() => void>()
  const mediaQueryList = {
    matches: initialMatches,
    addEventListener: (_type: 'change', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'change', listener: () => void) => listeners.delete(listener),
  }
  const fireChange = () => {
    for (const listener of listeners) {
      listener()
    }
  }
  return { mediaQueryList, fireChange }
}

describe('client/dom/use-media-query', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('returns the initial match state and re-renders when it changes', () => {
    const { mediaQueryList, fireChange } = makeFakeMediaQueryList(false)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mediaQueryList),
    )

    const { result } = renderHook(() => useMediaQuery('(width < 1000px)'))

    expect(result.current).toBe(false)

    act(() => {
      mediaQueryList.matches = true
      fireChange()
    })

    expect(result.current).toBe(true)
  })
})
