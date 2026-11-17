import { describe, expect, test } from 'vitest'
import { ALL_GAME_TYPES, GameType } from '../../../common/games/game-type'
import { gameTypeForSelectedMap } from './map-game-type'

describe('lobbies/create/map-game-type', () => {
  test('a UMS map selects Use Map Settings from any game type', () => {
    for (const gameType of ALL_GAME_TYPES) {
      expect(gameTypeForSelectedMap(gameType, 'ums')).toBe(GameType.UseMapSettings)
    }
  })

  test('a melee map leaves every game type alone, Use Map Settings included', () => {
    for (const gameType of ALL_GAME_TYPES) {
      expect(gameTypeForSelectedMap(gameType, 'melee')).toBe(gameType)
    }
  })
})
