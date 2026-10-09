import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import createDeferred from '../../common/async/deferred'
import { makeSbUserId, type SbUserId } from '../../common/users/sb-user-id'
import { GameFeedbackKind } from '../gql/graphql'
import { useGameFeedback } from './game-feedback'

type Feedback = {
  id: string
  closesAt: string
  given: Array<{ userId: SbUserId; kind: GameFeedbackKind }>
  commendsRemaining: number
  commendsAvailableAt: string | null
  recentCommends: Array<{ userId: SbUserId; availableAt: string }>
}

type MutationResult = { error?: { graphQLErrors?: Array<{ extensions?: { code?: string } }> } }

const mocks = vi.hoisted(() => ({
  feedbackByGame: new Map<string, unknown>(),
  staleFeedback: undefined as unknown,
  useStaleFeedback: false,
  mutate: vi.fn<(...args: Array<unknown>) => Promise<unknown>>(),
  refetch: vi.fn(),
  snackbar: vi.fn(),
}))

vi.mock('urql', () => ({
  useQuery: ({ variables }: { variables: { gameId: string } }) => [
    {
      data: {
        gameFeedback: mocks.useStaleFeedback
          ? mocks.staleFeedback
          : mocks.feedbackByGame.get(variables.gameId),
      },
    },
    mocks.refetch,
  ],
  useMutation: () => [{}, mocks.mutate],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, value?: string | { defaultValue?: string }) =>
      typeof value === 'string' ? value : (value?.defaultValue ?? _key),
  }),
}))

vi.mock('../snackbars/snackbar-overlay', () => ({
  useSnackbarController: () => ({ showSnackbar: mocks.snackbar }),
}))

const player = makeSbUserId(2)
const other = makeSbUserId(3)
const third = makeSbUserId(4)

function feedback(id: string, overrides: Partial<Feedback> = {}): Feedback {
  return {
    id,
    closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    given: [],
    commendsRemaining: 2,
    commendsAvailableAt: null,
    recentCommends: [],
    ...overrides,
  }
}

beforeEach(() => {
  mocks.feedbackByGame.clear()
  mocks.staleFeedback = undefined
  mocks.useStaleFeedback = false
  mocks.mutate.mockReset().mockResolvedValue({ data: {} })
  mocks.refetch.mockReset()
  mocks.snackbar.mockReset()
})

describe('useGameFeedback', () => {
  test('keeps game A feedback scoped when game B has no given feedback', async () => {
    mocks.feedbackByGame.set('game-a', feedback('game-a'))
    mocks.feedbackByGame.set(
      'game-b',
      feedback('game-b', {
        commendsRemaining: 1,
        recentCommends: [
          { userId: player, availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
        ],
      }),
    )
    const { result, rerender } = renderHook(
      ({ gameId }) => useGameFeedback(gameId, [player, other], true),
      { initialProps: { gameId: 'game-a' } },
    )

    await act(async () => result.current.commend(player, 'Player'))
    mocks.feedbackByGame.set(
      'game-a',
      feedback('game-a', {
        given: [{ userId: player, kind: GameFeedbackKind.Commend }],
        commendsRemaining: 1,
        recentCommends: [
          { userId: player, availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
        ],
      }),
    )
    rerender({ gameId: 'game-a' })
    expect(result.current.candidates).not.toContain(player)

    rerender({ gameId: 'game-b' })
    expect(result.current.candidates).toContain(player)
    expect(result.current.commendAvailability(player).kind).toBe('blocked')
    expect(result.current.commendAvailability(other)).toEqual({ kind: 'available' })
  })

  test('an error from game A does not roll back game B pending commend or allowance', async () => {
    const pendingA = createDeferred<MutationResult>()
    const pendingB = createDeferred<MutationResult>()
    mocks.feedbackByGame.set('game-a', feedback('game-a', { commendsRemaining: 1 }))
    mocks.feedbackByGame.set('game-b', feedback('game-b', { commendsRemaining: 1 }))
    mocks.mutate.mockReturnValueOnce(pendingA).mockReturnValueOnce(pendingB)
    const { result, rerender } = renderHook(
      ({ gameId }) => useGameFeedback(gameId, [player, other], true),
      { initialProps: { gameId: 'game-a' } },
    )

    act(() => result.current.commend(player, 'Player'))
    rerender({ gameId: 'game-b' })
    act(() => result.current.commend(player, 'Player'))
    expect(result.current.candidates).not.toContain(player)
    expect(result.current.commendAvailability(other)).toEqual({ kind: 'blocked', reason: 'limit' })

    await act(async () => pendingA.resolve({ error: { graphQLErrors: [] } }))
    expect(result.current.candidates).not.toContain(player)
    expect(result.current.commendAvailability(other)).toEqual({ kind: 'blocked', reason: 'limit' })
  })

  test('retains game A pending state across A to B to A and restores its allowance on error', async () => {
    const pendingA = createDeferred<MutationResult>()
    mocks.feedbackByGame.set('game-a', feedback('game-a', { commendsRemaining: 1 }))
    mocks.feedbackByGame.set('game-b', feedback('game-b'))
    mocks.mutate.mockReturnValueOnce(pendingA)
    const { result, rerender } = renderHook(
      ({ gameId }) => useGameFeedback(gameId, [player, other], true),
      { initialProps: { gameId: 'game-a' } },
    )

    act(() => result.current.commend(player, 'Player'))
    expect(result.current.candidates).not.toContain(player)
    expect(result.current.commendAvailability(other)).toEqual({ kind: 'blocked', reason: 'limit' })
    rerender({ gameId: 'game-b' })
    expect(result.current.candidates).toContain(player)
    rerender({ gameId: 'game-a' })
    expect(result.current.candidates).not.toContain(player)

    await act(async () => pendingA.resolve({ error: { graphQLErrors: [] } }))
    expect(result.current.candidates).toContain(player)
    expect(result.current.commendAvailability(other)).toEqual({ kind: 'available' })
  })

  test('does not deduct again when the server confirms a pending commend', async () => {
    mocks.feedbackByGame.set('game-a', feedback('game-a'))
    const mutation = createDeferred<MutationResult>()
    mocks.mutate.mockReturnValueOnce(mutation)
    const { result, rerender } = renderHook(() => useGameFeedback('game-a', [player, other], true))

    act(() => result.current.commend(player, 'Player'))
    expect(result.current.candidates).not.toContain(player)
    expect(result.current.commendAvailability(other)).toEqual({ kind: 'available' })
    await act(async () => mutation.resolve({}))
    expect(result.current.candidates).not.toContain(player)
    expect(result.current.commendAvailability(other)).toEqual({ kind: 'available' })
    mocks.feedbackByGame.set(
      'game-a',
      feedback('game-a', {
        given: [{ userId: player, kind: GameFeedbackKind.Commend }],
        commendsRemaining: 1,
        recentCommends: [
          { userId: player, availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
        ],
      }),
    )
    rerender()
    expect(result.current.candidates).not.toContain(player)
    expect(result.current.commendAvailability(other)).toEqual({ kind: 'available' })
  })

  test('keeps concurrent submissions hidden when an older server snapshot arrives later', async () => {
    mocks.feedbackByGame.set('game-a', feedback('game-a', { commendsRemaining: 2 }))
    const firstMutation = createDeferred<MutationResult>()
    const secondMutation = createDeferred<MutationResult>()
    mocks.mutate.mockReturnValueOnce(firstMutation).mockReturnValueOnce(secondMutation)
    const { result, rerender } = renderHook(() =>
      useGameFeedback('game-a', [player, other, third], true),
    )

    act(() => result.current.commend(player, 'Player'))
    act(() => result.current.commend(other, 'Other'))
    await act(async () => secondMutation.resolve({}))
    mocks.feedbackByGame.set(
      'game-a',
      feedback('game-a', {
        given: [
          { userId: player, kind: GameFeedbackKind.Commend },
          { userId: other, kind: GameFeedbackKind.Commend },
        ],
        commendsRemaining: 0,
      }),
    )
    rerender()
    expect(result.current.candidates).not.toContain(player)
    expect(result.current.candidates).not.toContain(other)
    expect(result.current.commendAvailability(third)).toEqual({ kind: 'blocked', reason: 'limit' })

    await act(async () => firstMutation.resolve({}))
    mocks.feedbackByGame.set(
      'game-a',
      feedback('game-a', {
        given: [{ userId: player, kind: GameFeedbackKind.Commend }],
        commendsRemaining: 1,
      }),
    )
    rerender()
    expect(result.current.candidates).not.toContain(other)
    expect(result.current.commendAvailability(third)).toEqual({ kind: 'blocked', reason: 'limit' })
  })

  test('ignores stale feedback for another game and suppresses cached data when disabled', () => {
    mocks.staleFeedback = feedback('game-a')
    mocks.useStaleFeedback = true
    const { result, rerender } = renderHook(
      ({ gameId, enabled }) => useGameFeedback(gameId, [player, other], enabled),
      { initialProps: { gameId: 'game-b', enabled: true } },
    )

    expect(result.current.candidates).toEqual([])
    rerender({ gameId: 'game-a', enabled: false })
    expect(result.current.candidates).toEqual([])
    expect(result.current.commendAvailability(other)).toEqual({ kind: 'blocked', reason: 'limit' })
  })
})
