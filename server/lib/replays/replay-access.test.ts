import { describe, expect, test } from 'vitest'
import { GameSource } from '../../../common/games/configuration'
import { GameRecord } from '../../../common/games/games'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { canUserAccessReplay } from './replay-access'

function lobbyGame(observers?: number[]): GameRecord {
  return {
    config: {
      gameSource: GameSource.Lobby,
      teams: [
        [
          { id: makeSbUserId(1), race: 'z', isComputer: false },
          { id: makeSbUserId(2), race: 'p', isComputer: false },
        ],
      ],
      observers: observers?.map(o => makeSbUserId(o)),
    },
  } as GameRecord
}

describe('canUserAccessReplay', () => {
  test('allows players of a lobby game', () => {
    expect(canUserAccessReplay(lobbyGame(), makeSbUserId(1))).toBe(true)
  })

  test('allows observers of a lobby game', () => {
    expect(canUserAccessReplay(lobbyGame([3]), makeSbUserId(3))).toBe(true)
  })

  test('denies non-participants of a lobby game', () => {
    expect(canUserAccessReplay(lobbyGame([3]), makeSbUserId(4))).toBe(false)
    expect(canUserAccessReplay(lobbyGame(), makeSbUserId(3))).toBe(false)
    expect(canUserAccessReplay(lobbyGame([3]), undefined)).toBe(false)
  })
})
