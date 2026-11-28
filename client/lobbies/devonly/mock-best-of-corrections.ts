import { nanoid } from 'nanoid'
import {
  BestOfHostResult,
  BestOfSideIndex,
  getBestOfOutcomeAfterChange,
  isBestOfAddedResult,
  LobbyBestOfGameJson,
  LobbyBestOfJson,
  LobbyBestOfOutcome,
} from '../../../common/lobbies/lobby-best-of'
import { LobbyBestOfCorrection } from '../../../common/lobbies/lobby-network'
import { ReduxAction } from '../../action-types'

function isSameOutcome(a: LobbyBestOfOutcome | undefined, b: LobbyBestOfOutcome | undefined) {
  if (!a || !b) {
    return a === b
  }
  return a.kind === b.kind && (a.kind !== 'won' || b.kind !== 'won' || a.winner === b.winner)
}

/** A mock series after a change, and the actions that tell the page's store about it. */
export interface MockBestOfChange {
  bestOf: LobbyBestOfJson
  actions: ReduxAction[]
}

/**
 * Applies a change to a mock series' results or format the way the server does: the series gets
 * the outcome `getBestOfOutcomeAfterChange` calls for, a correction is announced as one, and an
 * outcome the series didn't have before is announced as its end.
 */
export function applyMockBestOfChange(
  previous: LobbyBestOfJson,
  changed: LobbyBestOfJson,
  correction?: LobbyBestOfCorrection,
): MockBestOfChange {
  const outcome = getBestOfOutcomeAfterChange(changed, previous.outcome)
  const { outcome: _, ...rest } = changed
  const bestOf: LobbyBestOfJson = outcome ? { ...rest, outcome } : rest

  const actions: ReduxAction[] = []
  if (correction) {
    const wasDecided = previous.outcome?.kind === 'won' || previous.outcome?.kind === 'drawn'
    actions.push({
      type: '@lobbies/updateBestOfCorrected',
      payload: { type: 'bestOfCorrected', bestOf, correction, reopened: wasDecided && !outcome },
    })
  }
  if (outcome && !isSameOutcome(outcome, previous.outcome)) {
    actions.push({ type: '@lobbies/updateBestOfEnded', payload: { type: 'bestOfEnded', bestOf } })
  } else if (!correction) {
    actions.push({
      type: '@lobbies/updateBestOfUpdated',
      payload: { type: 'bestOfUpdated', bestOf },
    })
  }
  return { bestOf, actions }
}

/** Sets the result of one of a mock series' games, as the host's correction does. */
export function mockSetBestOfGameResult(
  bestOf: LobbyBestOfJson,
  gameId: string,
  result: BestOfHostResult,
): MockBestOfChange {
  const set: LobbyBestOfGameJson =
    result.status === 'won'
      ? { gameId, status: 'won', winner: result.winner, setByHost: true }
      : { gameId, status: 'notCounted' }
  return applyMockBestOfChange(
    bestOf,
    {
      ...bestOf,
      games: bestOf.games.map(game =>
        !isBestOfAddedResult(game) && game.gameId === gameId ? set : game,
      ),
    },
    { kind: 'gameResult', gameId, result },
  )
}

/** Adds a win with no game behind it to a mock series, as the host's correction does. */
export function mockAddBestOfResult(
  bestOf: LobbyBestOfJson,
  winner: BestOfSideIndex,
): MockBestOfChange {
  return applyMockBestOfChange(
    bestOf,
    { ...bestOf, games: [...bestOf.games, { resultId: nanoid(), status: 'won', winner }] },
    { kind: 'resultAdded', winner },
  )
}

/**
 * Removes a win the host added to a mock series, as their correction does. Returns `undefined`
 * when the series has no such result.
 */
export function mockRemoveBestOfResult(
  bestOf: LobbyBestOfJson,
  resultId: string,
): MockBestOfChange | undefined {
  const removed = bestOf.games.find(game => isBestOfAddedResult(game) && game.resultId === resultId)
  if (!removed || !isBestOfAddedResult(removed)) {
    return undefined
  }
  return applyMockBestOfChange(
    bestOf,
    { ...bestOf, games: bestOf.games.filter(game => game !== removed) },
    { kind: 'resultRemoved', winner: removed.winner },
  )
}

/**
 * Applies a running mock series' saved length and play-all setting, alongside whatever else the
 * save changed (already applied to `updated`), the way the server does: a format change is a
 * correction, and anything else is a plain update.
 */
export function mockUpdateBestOfFormat(
  previous: LobbyBestOfJson,
  updated: LobbyBestOfJson,
  { length, playAll }: { length?: number; playAll?: boolean },
): MockBestOfChange {
  const newLength = length ?? previous.length
  const newPlayAll = playAll ?? !!previous.playAll
  const { playAll: _, ...rest } = updated
  const changed: LobbyBestOfJson = {
    ...rest,
    length: newLength,
    ...(newPlayAll ? { playAll: true } : {}),
  }
  const formatChanged = newLength !== previous.length || newPlayAll !== !!previous.playAll
  return applyMockBestOfChange(
    previous,
    changed,
    formatChanged ? { kind: 'format', length: newLength, playAll: newPlayAll } : undefined,
  )
}
