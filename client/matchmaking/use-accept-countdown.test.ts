import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchmakingType } from '../../common/matchmaking'
import { FoundMatch } from './matchmaking-atoms'
import { useAcceptCountdown } from './use-accept-countdown'

const TICK_MS = 100

function makeMatch(acceptStart: number, acceptTimeTotalMillis = 30000): FoundMatch {
  return {
    matchmakingType: MatchmakingType.Match1v1,
    numPlayers: 2,
    acceptStart,
    acceptTimeTotalMillis,
    acceptedPlayers: 0,
    hasAccepted: false,
  }
}

describe('client/matchmaking/use-accept-countdown', () => {
  beforeEach(() => {
    // `performance.now()` is what the countdown reads, and it isn't faked by default.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('describes an empty window with no match, and does not tick', () => {
    const { result } = renderHook(() => useAcceptCountdown(undefined, TICK_MS))

    expect(result.current).toEqual({
      remainingMillis: 0,
      secondsLeft: 0,
      remainingFrac: 0,
      lowTime: false,
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  test('counts the window down as time passes', () => {
    const match = makeMatch(performance.now(), 30000)
    const { result } = renderHook(() => useAcceptCountdown(match, TICK_MS))

    expect(result.current.secondsLeft).toBe(30)
    expect(result.current.remainingFrac).toBe(1)

    act(() => {
      vi.advanceTimersByTime(15000)
    })

    expect(result.current.secondsLeft).toBe(15)
    expect(result.current.remainingFrac).toBeCloseTo(0.5)
    expect(result.current.lowTime).toBe(false)
  })

  test('rounds partial seconds up so the display never reads zero early', () => {
    const match = makeMatch(performance.now(), 30000)
    const { result } = renderHook(() => useAcceptCountdown(match, TICK_MS))

    act(() => {
      vi.advanceTimersByTime(29500)
    })

    expect(result.current.secondsLeft).toBe(1)
    expect(result.current.lowTime).toBe(true)
  })

  test('updates at a deadline-relative second boundary when mounted off phase', () => {
    act(() => {
      vi.advanceTimersByTime(37)
    })
    const match = makeMatch(0, 60000)
    const { result } = renderHook(() => useAcceptCountdown(match, TICK_MS))

    expect(result.current.secondsLeft).toBe(60)

    act(() => {
      vi.advanceTimersByTime(962)
    })
    expect(result.current.secondsLeft).toBe(60)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.secondsLeft).toBe(59)
  })

  test('switches to low time exactly at the six-to-five-second boundary', () => {
    const match = makeMatch(performance.now(), 30000)
    const { result } = renderHook(() => useAcceptCountdown(match, TICK_MS))

    act(() => {
      vi.advanceTimersByTime(24000)
    })
    expect(result.current.secondsLeft).toBe(6)
    expect(result.current.lowTime).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.secondsLeft).toBe(5)
    expect(result.current.lowTime).toBe(true)
  })

  test('bottoms out at zero once the window has passed', () => {
    const match = makeMatch(performance.now(), 30000)
    const { result } = renderHook(() => useAcceptCountdown(match, TICK_MS))

    act(() => {
      vi.advanceTimersByTime(45000)
    })

    expect(result.current).toEqual({
      remainingMillis: 0,
      secondsLeft: 0,
      remainingFrac: 0,
      lowTime: true,
    })
  })

  test('shows the full window on the first render after a match is found', () => {
    const { result, rerender } = renderHook(
      ({ match }: { match: FoundMatch | undefined }) => useAcceptCountdown(match, TICK_MS),
      { initialProps: { match: undefined as FoundMatch | undefined } },
    )

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    rerender({ match: makeMatch(performance.now(), 30000) })

    expect(result.current.secondsLeft).toBe(30)
    expect(result.current.remainingFrac).toBe(1)
  })

  test('reschedules for a replacement match without accumulating timers', () => {
    const { result, rerender } = renderHook(
      ({ match }: { match: FoundMatch | undefined }) => useAcceptCountdown(match, TICK_MS),
      { initialProps: { match: makeMatch(performance.now(), 30000) as FoundMatch | undefined } },
    )

    act(() => {
      vi.advanceTimersByTime(37)
    })
    rerender({ match: makeMatch(-5000, 30000) })

    expect(result.current.secondsLeft).toBe(25)
    expect(vi.getTimerCount()).toBe(1)

    act(() => {
      vi.advanceTimersByTime(962)
    })
    expect(result.current.secondsLeft).toBe(25)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.secondsLeft).toBe(24)
  })

  test('stops ticking once the match is gone', () => {
    const { rerender } = renderHook(
      ({ match }: { match: FoundMatch | undefined }) => useAcceptCountdown(match, TICK_MS),
      { initialProps: { match: makeMatch(performance.now()) as FoundMatch | undefined } },
    )
    expect(vi.getTimerCount()).toBe(1)

    rerender({ match: undefined })

    expect(vi.getTimerCount()).toBe(0)
  })
})
