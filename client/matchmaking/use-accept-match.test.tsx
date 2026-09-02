import { act, renderHook } from '@testing-library/react'
import { createStore as createJotaiStore, Provider as JotaiProvider } from 'jotai'
import { ReactNode } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchmakingServiceErrorCode, MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import createReduxStore from '../create-store'
import type { RequestHandlingSpec } from '../network/abortable-thunk'
import { FetchError } from '../network/fetch-errors'
import {
  currentSearchInfoAtom,
  FoundMatch,
  foundMatchAtom,
  hasAcceptedAtom,
} from './matchmaking-atoms'
import { useAcceptMatch } from './use-accept-match'

// Stand in for the real accept request so tests decide when (and how) each one completes. Every
// call's spec is recorded so the test can answer them in order.
const { acceptMatchMock, specs } = vi.hoisted(() => {
  const specs: Array<RequestHandlingSpec<void>> = []
  const acceptMatchMock = vi.fn((spec: RequestHandlingSpec<void>) => {
    specs.push(spec)
    return () => {}
  })
  return { acceptMatchMock, specs }
})

vi.mock('./action-creators', () => ({
  acceptMatch: acceptMatchMock,
}))

const RETRY_DELAY_MS = 400

let reduxStore: ReturnType<typeof createReduxStore>
let jotaiStore: ReturnType<typeof createJotaiStore>

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ReduxProvider store={reduxStore}>
      <JotaiProvider store={jotaiStore}>{children}</JotaiProvider>
    </ReduxProvider>
  )
}

function makeMatch(): FoundMatch {
  return {
    matchmakingType: MatchmakingType.Match1v1,
    numPlayers: 2,
    acceptStart: 0,
    acceptTimeTotalMillis: 30000,
    acceptedPlayers: 0,
    hasAccepted: false,
  }
}

function foundMatch() {
  act(() => {
    jotaiStore.set(foundMatchAtom, makeMatch())
  })
}

function searching() {
  act(() => {
    jotaiStore.set(currentSearchInfoAtom, {
      searchedTypes: new Map<MatchmakingType, RaceChar>([[MatchmakingType.Match1v1, 'p']]),
      startTime: 0,
    })
  })
}

/** Builds the error a failed accept throws when the server has no match to accept anymore. */
function noActiveMatchError(): FetchError {
  return new FetchError(
    new Response('', { status: 409, statusText: 'Conflict' }),
    JSON.stringify({ code: MatchmakingServiceErrorCode.NoActiveMatch }),
  )
}

function failLatest(err: Error) {
  act(() => {
    specs[specs.length - 1].onError(err)
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('client/matchmaking/use-accept-match', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    specs.length = 0
    acceptMatchMock.mockClear()
    reduxStore = createReduxStore()
    jotaiStore = createJotaiStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('clears matchmaking state when the match being accepted is gone', () => {
    searching()
    foundMatch()
    const onNoActiveMatch = vi.fn()
    const { result } = renderHook(() => useAcceptMatch(onNoActiveMatch), { wrapper })

    act(() => result.current.triggerAccept())
    failLatest(noActiveMatchError())

    expect(jotaiStore.get(foundMatchAtom)).toBeUndefined()
    expect(jotaiStore.get(currentSearchInfoAtom)).toBeUndefined()
    expect(onNoActiveMatch).toHaveBeenCalled()
    expect(result.current.acceptInProgress).toBe(false)
  })

  test('leaves a newly found match alone when an older accept reports no active match', () => {
    searching()
    foundMatch()
    const onNoActiveMatch = vi.fn()
    const { result } = renderHook(() => useAcceptMatch(onNoActiveMatch), { wrapper })

    act(() => result.current.triggerAccept())
    // The match dissolves, the client is requeued, and a new match is found before the accept for
    // the old one is answered.
    act(() => {
      jotaiStore.set(foundMatchAtom, undefined)
    })
    foundMatch()
    failLatest(noActiveMatchError())

    expect(jotaiStore.get(foundMatchAtom)).toBeDefined()
    expect(jotaiStore.get(currentSearchInfoAtom)).toBeDefined()
    expect(onNoActiveMatch).not.toHaveBeenCalled()
  })

  test('retries a transient failure for the match it was sent for', () => {
    foundMatch()
    const { result } = renderHook(() => useAcceptMatch(), { wrapper })

    act(() => result.current.triggerAccept())
    failLatest(new Error('network go boom'))

    // The accept stays in progress across the backoff so the button can't start a second chain.
    expect(result.current.acceptInProgress).toBe(true)
    expect(acceptMatchMock).toHaveBeenCalledTimes(1)

    advance(RETRY_DELAY_MS)

    expect(acceptMatchMock).toHaveBeenCalledTimes(2)
    expect(result.current.acceptInProgress).toBe(true)
  })

  test('drops a pending retry when a different match has been found', () => {
    foundMatch()
    const { result } = renderHook(() => useAcceptMatch(), { wrapper })

    act(() => result.current.triggerAccept())
    failLatest(new Error('network go boom'))
    act(() => {
      jotaiStore.set(foundMatchAtom, undefined)
    })
    foundMatch()

    advance(RETRY_DELAY_MS)

    expect(acceptMatchMock).toHaveBeenCalledTimes(1)
    expect(jotaiStore.get(hasAcceptedAtom)).toBe(false)
    expect(result.current.acceptInProgress).toBe(false)
  })

  test('drops a pending retry when the match is gone entirely', () => {
    foundMatch()
    const { result } = renderHook(() => useAcceptMatch(), { wrapper })

    act(() => result.current.triggerAccept())
    failLatest(new Error('network go boom'))
    act(() => {
      jotaiStore.set(foundMatchAtom, undefined)
    })

    advance(RETRY_DELAY_MS)

    expect(acceptMatchMock).toHaveBeenCalledTimes(1)
    expect(result.current.acceptInProgress).toBe(false)
  })

  test('gives each user-initiated accept its own retry budget', () => {
    foundMatch()
    const { result } = renderHook(() => useAcceptMatch(), { wrapper })

    act(() => result.current.triggerAccept())
    // Burn the whole budget on the first accept.
    for (let i = 0; i <= 10; i++) {
      failLatest(new Error('network go boom'))
      advance(RETRY_DELAY_MS)
    }
    const afterBudget = acceptMatchMock.mock.calls.length
    expect(afterBudget).toBe(11)
    expect(result.current.acceptInProgress).toBe(false)

    act(() => result.current.triggerAccept())
    failLatest(new Error('network go boom'))
    advance(RETRY_DELAY_MS)

    expect(acceptMatchMock).toHaveBeenCalledTimes(afterBudget + 2)
  })
})
