import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GetGameResponse } from '../../common/games/games'
import { fetchJson } from '../network/fetch'
import { ensureReplayCached, startReplay } from '../replays/action-creators'
import { watchGameReplay } from './action-creators'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../common/ipc', () => ({
  TypedIpcRenderer: class {
    invoke = mocks.invoke
  },
}))
vi.mock('../logging/logger', () => ({ default: { error: vi.fn() } }))
vi.mock('../network/fetch', () => ({ fetchJson: vi.fn() }))
vi.mock('../replays/action-creators', () => ({
  ensureReplayCached: vi.fn(),
  startReplay: vi.fn((args: unknown) => ({ type: 'startReplay', args })),
}))

const GAME_ID = 'game-1'
const HELD_REPLAY = { id: 'replay-1', hash: 'abc' }
const FRESH_REPLAY = {
  gameId: GAME_ID,
  id: 'replay-1',
  hash: 'abc',
  url: 'https://example.org/fresh',
  filename: 'replay',
}

function runWatch(): Promise<{ dispatched: unknown[]; error: unknown }> {
  const dispatched: unknown[] = []
  return new Promise(resolve => {
    watchGameReplay(HELD_REPLAY, GAME_ID, {
      onSuccess: () => resolve({ dispatched, error: undefined }),
      onError: error => resolve({ dispatched, error }),
    })(action => {
      dispatched.push(action)
      return action
    }, vi.fn())
  })
}

describe('client/games/action-creators/watchGameReplay', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    vi.mocked(fetchJson).mockReset()
    vi.mocked(ensureReplayCached).mockReset()
    vi.mocked(startReplay).mockClear()
  })

  test('starts a cached replay without fetching anything', async () => {
    mocks.invoke.mockResolvedValue('C:/cache/replay-1.rep')

    const { error } = await runWatch()

    expect(error).toBeUndefined()
    expect(fetchJson).not.toHaveBeenCalled()
    expect(ensureReplayCached).not.toHaveBeenCalled()
    expect(startReplay).toHaveBeenCalledWith({
      path: 'C:/cache/replay-1.rep',
      name: `Replay ${GAME_ID}`,
    })
  })

  test('downloads an uncached replay from a freshly fetched URL, since a held one can expire', async () => {
    mocks.invoke.mockResolvedValue(null)
    vi.mocked(fetchJson).mockResolvedValue({ replay: FRESH_REPLAY } as Partial<GetGameResponse>)
    vi.mocked(ensureReplayCached).mockResolvedValue('C:/cache/replay-1.rep')

    const { dispatched, error } = await runWatch()

    expect(error).toBeUndefined()
    expect(ensureReplayCached).toHaveBeenCalledWith(FRESH_REPLAY, undefined)
    expect(dispatched).toContainEqual({
      type: '@games/getGameRecord',
      payload: { replay: FRESH_REPLAY },
    })
    expect(startReplay).toHaveBeenCalledWith({
      path: 'C:/cache/replay-1.rep',
      name: `Replay ${GAME_ID}`,
    })
  })

  test('fails when the refetched game no longer has a replay', async () => {
    mocks.invoke.mockResolvedValue(null)
    vi.mocked(fetchJson).mockResolvedValue({} as Partial<GetGameResponse>)

    const { error } = await runWatch()

    expect(error).toBeInstanceOf(Error)
    expect(ensureReplayCached).not.toHaveBeenCalled()
    expect(startReplay).not.toHaveBeenCalled()
  })
})
