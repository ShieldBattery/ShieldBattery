import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LobbyLifecycle, LobbySummaryResponse } from '../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { asMockedFunction } from '../../common/testing/mocks'
import { fetchJson } from '../network/fetch'
import { FetchError } from '../network/fetch-errors'
import { fetchLobbySummary, resetSummaryCacheForTesting, useLobbySummary } from './lobby-summary'

vi.mock('../network/fetch', () => ({
  fetchJson: vi.fn(),
}))

const fetchJsonMock = asMockedFunction(fetchJson)

const RESPONSE = { summary: { name: 'Test lobby' }, host: { name: 'host' } } as LobbySummaryResponse

function summaryFor(lifecycle: LobbyLifecycle): LobbySummaryResponse {
  return {
    summary: { name: 'Test lobby', lifecycle },
    host: { name: 'host' },
  } as LobbySummaryResponse
}

function notFoundError(): FetchError {
  return new FetchError(new Response('', { status: 404, statusText: 'Not Found' }), '')
}

/** Lets every pending fetch settle and the hook re-render off it, `ms` of fake time later. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('client/lobbies/lobby-summary/fetchLobbySummary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    resetSummaryCacheForTesting()
    fetchJsonMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('shares one request across concurrent cached reads', async () => {
    fetchJsonMock.mockResolvedValue(RESPONSE)
    const id = makeSbLobbyId('lobby-a')

    const [first, second] = await Promise.all([
      fetchLobbySummary(id, { cached: true }),
      fetchLobbySummary(id, { cached: true }),
    ])

    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ status: 'loaded', data: RESPONSE })
    expect(second).toEqual({ status: 'loaded', data: RESPONSE })
  })

  test('serves a cached result within the window and refetches after it expires', async () => {
    fetchJsonMock.mockResolvedValue(RESPONSE)
    const id = makeSbLobbyId('lobby-a')

    await fetchLobbySummary(id, { cached: true })
    vi.advanceTimersByTime(10 * 1000)
    await fetchLobbySummary(id, { cached: true })
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(31 * 1000)
    await fetchLobbySummary(id, { cached: true })
    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
  })

  test('caches a 404 like any other result', async () => {
    fetchJsonMock.mockRejectedValue(notFoundError())
    const id = makeSbLobbyId('lobby-a')

    const first = await fetchLobbySummary(id, { cached: true })
    const second = await fetchLobbySummary(id, { cached: true })

    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ status: 'notFound' })
    expect(second).toEqual({ status: 'notFound' })
  })

  test('does not cache a transient failure, so the next reader retries', async () => {
    fetchJsonMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValue(RESPONSE)
    const id = makeSbLobbyId('lobby-a')

    const first = await fetchLobbySummary(id, { cached: true })
    const second = await fetchLobbySummary(id, { cached: true })

    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
    expect(first).toEqual({ status: 'error' })
    expect(second).toEqual({ status: 'loaded', data: RESPONSE })
  })

  test('denies reads past the fetch budget without caching the denial', async () => {
    fetchJsonMock.mockResolvedValue(RESPONSE)

    for (let i = 0; i < 15; i++) {
      await fetchLobbySummary(makeSbLobbyId(`lobby-${i}`), { cached: true })
    }
    expect(fetchJsonMock).toHaveBeenCalledTimes(15)

    const denied = await fetchLobbySummary(makeSbLobbyId('lobby-15'), { cached: true })
    expect(denied).toEqual({ status: 'error' })
    expect(fetchJsonMock).toHaveBeenCalledTimes(15)

    // The budget refills in the next window, and the denial wasn't cached as this lobby's result
    vi.advanceTimersByTime(31 * 1000)
    const retried = await fetchLobbySummary(makeSbLobbyId('lobby-15'), { cached: true })
    expect(retried).toEqual({ status: 'loaded', data: RESPONSE })
    expect(fetchJsonMock).toHaveBeenCalledTimes(16)
  })

  test('a stale failing request does not evict a fresher cache entry', async () => {
    const id = makeSbLobbyId('lobby-a')
    let rejectFirst: (err: Error) => void = () => {}
    fetchJsonMock
      .mockImplementationOnce(
        () =>
          new Promise<LobbySummaryResponse>((_resolve, reject) => {
            rejectFirst = reject
          }),
      )
      .mockResolvedValue(RESPONSE)

    const first = fetchLobbySummary(id, { cached: true })

    // The first request outlives its whole cache window, and a second read starts a fresh one
    vi.advanceTimersByTime(31 * 1000)
    const second = await fetchLobbySummary(id, { cached: true })
    expect(second).toEqual({ status: 'loaded', data: RESPONSE })
    expect(fetchJsonMock).toHaveBeenCalledTimes(2)

    rejectFirst(new Error('timed out'))
    expect(await first).toEqual({ status: 'error' })

    // The late failure must not have evicted the fresh entry
    const third = await fetchLobbySummary(id, { cached: true })
    expect(third).toEqual({ status: 'loaded', data: RESPONSE })
    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
  })

  test('uncached reads always hit the network', async () => {
    fetchJsonMock.mockResolvedValue(RESPONSE)
    const id = makeSbLobbyId('lobby-a')

    await fetchLobbySummary(id)
    await fetchLobbySummary(id)

    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
  })
})

describe('client/lobbies/lobby-summary/useLobbySummary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    resetSummaryCacheForTesting()
    fetchJsonMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('keeps a rendered summary when a cached refresh fails', async () => {
    const id = makeSbLobbyId('lobby-a')
    fetchJsonMock
      .mockResolvedValueOnce(summaryFor('gathering'))
      .mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useLobbySummary(id, { cached: true }))
    await advance(0)

    // Past the shared cache window, so the refresh actually reaches the network
    await advance(31 * 1000)
    await act(async () => {
      result.current[1]()
    })
    await advance(0)

    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
    expect(result.current[0]).toEqual({ status: 'loaded', data: summaryFor('gathering') })
  })

  test('replaces a rendered summary when a refresh finds the lobby gone', async () => {
    const id = makeSbLobbyId('lobby-a')
    fetchJsonMock.mockResolvedValueOnce(summaryFor('gathering')).mockRejectedValue(notFoundError())

    const { result } = renderHook(() => useLobbySummary(id))
    await advance(0)
    await act(async () => {
      result.current[1]()
    })
    await advance(0)

    expect(result.current[0]).toEqual({ status: 'notFound' })
  })
})
