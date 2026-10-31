import { act, renderHook } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import * as React from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { jotaiStore } from '../jotai-store'
import { RequestHandlingSpec } from '../network/abortable-thunk'
import { watchGameReplay } from './action-creators'
import { startingReplayGameIdsAtom } from './game-atoms'
import { useGameReplayActions } from './use-game-replay-actions'

const GAME_ID = 'game-1'
const REPLAY_INFO = {
  gameId: GAME_ID,
  id: 'replay-1',
  url: 'https://example.org/replay',
  hash: 'abc',
  filename: 'replay',
}

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }))

vi.mock('./action-creators', () => ({ watchGameReplay: vi.fn(() => ({ type: 'watch' })) }))
vi.mock('../dialogs/action-creators', () => ({
  openSimpleDialog: vi.fn(() => ({ type: 'dialog' })),
}))
vi.mock('../logging/logger', () => ({ default: { error: vi.fn() } }))
vi.mock('../redux-hooks', () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ games: { replayInfoById: new Map([[GAME_ID, REPLAY_INFO]]) } }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, value: string) => value }),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  return <JotaiProvider store={jotaiStore}>{children}</JotaiProvider>
}

/** Renders the hook twice for one game, as e.g. a chat card and a side panel would. */
function renderTwoSurfaces() {
  return renderHook(() => [useGameReplayActions(GAME_ID), useGameReplayActions(GAME_ID)] as const, {
    wrapper,
  })
}

function lastWatchSpec(): RequestHandlingSpec {
  return vi.mocked(watchGameReplay).mock.lastCall![2]
}

describe('client/games/use-game-replay-actions', () => {
  beforeEach(() => {
    jotaiStore.set(startingReplayGameIdsAtom, new Set())
    vi.mocked(watchGameReplay).mockClear()
    mocks.dispatch.mockReset()
  })

  test('ignores watch presses from any surface while a replay is starting', () => {
    const { result } = renderTwoSurfaces()

    act(() => {
      result.current[0].onWatchReplay()
      result.current[0].onWatchReplay()
      result.current[1].onWatchReplay()
    })

    expect(watchGameReplay).toHaveBeenCalledTimes(1)
    expect(result.current[0].isStartingReplay).toBe(true)
    expect(result.current[1].isStartingReplay).toBe(true)
  })

  test('allows watching again once the replay has started', () => {
    const { result } = renderTwoSurfaces()

    act(() => result.current[0].onWatchReplay())
    act(() => lastWatchSpec().onSuccess(undefined))

    expect(result.current[1].isStartingReplay).toBe(false)
    act(() => result.current[1].onWatchReplay())
    expect(watchGameReplay).toHaveBeenCalledTimes(2)
  })

  test('allows watching again after a failure, and reports it', () => {
    const { result } = renderTwoSurfaces()

    act(() => result.current[0].onWatchReplay())
    act(() => lastWatchSpec().onError(new Error('download failed')))

    expect(result.current[0].isStartingReplay).toBe(false)
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'dialog' })
  })
})
