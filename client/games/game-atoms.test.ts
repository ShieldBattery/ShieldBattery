import { createStore } from 'jotai'
import { beforeEach, describe, expect, test } from 'vitest'
import { MatchmakingResultsEvent } from '../../common/games/games'
import { MatchmakingType } from '../../common/matchmaking'
import {
  endsOnPostGamePage,
  markPostGameResultsRevealedAtom,
  ParticipatingGameInfo,
  postGameResultsAtom,
  receivePostGameResultsAtom,
} from './game-atoms'

function makeEvent(gameId: string, points = 100, pointsChange = 10) {
  return {
    game: { id: gameId },
    mmrChange: { points, pointsChange },
  } as unknown as MatchmakingResultsEvent
}

describe('client/games/game-atoms/endsOnPostGamePage', () => {
  const matchmakingGame = {
    gameId: 'game',
    matchmakingType: MatchmakingType.Match1v1,
  } as ParticipatingGameInfo

  test('is true for the matchmaking game the user just played', () => {
    expect(endsOnPostGamePage('game', { id: 'game' }, matchmakingGame)).toBe(true)
  })

  test('is false for a lobby game', () => {
    const lobbyGame = { ...matchmakingGame, matchmakingType: undefined }
    expect(endsOnPostGamePage('game', { id: 'game' }, lobbyGame)).toBe(false)
  })

  test('is false once a new match has cleared the last game', () => {
    expect(endsOnPostGamePage('game', undefined, matchmakingGame)).toBe(false)
  })

  test('is false for a game that never reached the player', () => {
    expect(endsOnPostGamePage('other', { id: 'other' }, matchmakingGame)).toBe(false)
  })
})

describe('client/games/game-atoms/receivePostGameResultsAtom', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  test('starts results off unrevealed', () => {
    store.set(receivePostGameResultsAtom, makeEvent('game'))
    expect(store.get(postGameResultsAtom)?.revealed).toBe(false)
  })

  test('keeps results revealed when the same results are published again', () => {
    store.set(receivePostGameResultsAtom, makeEvent('game'))
    store.set(markPostGameResultsRevealedAtom, 'game')
    store.set(receivePostGameResultsAtom, makeEvent('game'))
    expect(store.get(postGameResultsAtom)?.revealed).toBe(true)
  })

  test('reveals again when the same game gets different results', () => {
    store.set(receivePostGameResultsAtom, makeEvent('game'))
    store.set(markPostGameResultsRevealedAtom, 'game')
    store.set(receivePostGameResultsAtom, makeEvent('game', 80, -10))
    expect(store.get(postGameResultsAtom)?.revealed).toBe(false)
  })

  test('reveals a different game', () => {
    store.set(receivePostGameResultsAtom, makeEvent('game'))
    store.set(markPostGameResultsRevealedAtom, 'game')
    store.set(receivePostGameResultsAtom, makeEvent('other'))
    expect(store.get(postGameResultsAtom)?.revealed).toBe(false)
  })
})

describe('client/games/game-atoms/markPostGameResultsRevealedAtom', () => {
  test('ignores a game that isn’t the one held', () => {
    const store = createStore()
    store.set(receivePostGameResultsAtom, makeEvent('game'))
    store.set(markPostGameResultsRevealedAtom, 'other')
    expect(store.get(postGameResultsAtom)?.revealed).toBe(false)
  })
})
