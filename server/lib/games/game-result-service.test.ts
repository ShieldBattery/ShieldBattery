import { describe, expect, test } from 'vitest'
import {
  GameConfigPlayer,
  GameSource,
  LobbyGameConfig,
  MatchmakingGameConfig,
} from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { getValidationTeams } from './game-result-service'

const p1 = makeSbUserId(1)
const p2 = makeSbUserId(2)
const p3 = makeSbUserId(3)
const humans = [p1, p2]

function matchmakingConfig(
  teams: GameConfigPlayer[][],
  overrides: Partial<MatchmakingGameConfig> = {},
): MatchmakingGameConfig {
  return {
    gameSource: GameSource.Matchmaking,
    gameSourceExtra: { type: MatchmakingType.Match1v1 },
    gameType: GameType.OneVsOne,
    gameSubType: 0,
    teams,
    ...overrides,
  }
}

function lobbyConfig(overrides: Partial<LobbyGameConfig> = {}): LobbyGameConfig {
  return {
    gameSource: GameSource.Lobby,
    gameType: GameType.Melee,
    gameSubType: 0,
    teams: DEFAULT_TEAMS,
    ...overrides,
  }
}

const DEFAULT_TEAMS: GameConfigPlayer[][] = [
  [{ id: p1, race: 't', isComputer: false }],
  [{ id: p2, race: 'z', isComputer: false }],
]

describe('games/game-result-service/getValidationTeams', () => {
  test('validates teams for a matchmaking config without lockedAlliances (legacy record)', () => {
    const config = matchmakingConfig(DEFAULT_TEAMS)
    expect(config.lockedAlliances).toBeUndefined()

    expect(getValidationTeams(config, humans)).toEqual([[p1], [p2]])
  })

  test('validates teams for a matchmaking config with lockedAlliances explicitly true', () => {
    const config = matchmakingConfig(DEFAULT_TEAMS, { lockedAlliances: true })

    expect(getValidationTeams(config, humans)).toEqual([[p1], [p2]])
  })

  test('validates teams for a lobby config with lockedAlliances: true', () => {
    const config = lobbyConfig({ lockedAlliances: true })

    expect(getValidationTeams(config, humans)).toEqual([[p1], [p2]])
  })

  test('does not validate teams for a lobby config without lockedAlliances', () => {
    const config = lobbyConfig()
    expect(config.lockedAlliances).toBeUndefined()

    expect(getValidationTeams(config, humans)).toBe(null)
  })

  test('does not validate teams for a lobby config with lockedAlliances: false', () => {
    const config = lobbyConfig({ lockedAlliances: false })

    expect(getValidationTeams(config, humans)).toBe(null)
  })

  test('falls back to one-player teams for a locked-alliance FFA melee with no determinable teams', () => {
    const config = matchmakingConfig([
      [
        { id: p1, race: 't', isComputer: false },
        { id: p2, race: 'z', isComputer: false },
        { id: p3, race: 'p', isComputer: false },
      ],
    ])

    expect(getValidationTeams(config, [p1, p2, p3])).toEqual([[p1], [p2], [p3]])
  })
})
