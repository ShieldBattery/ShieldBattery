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
import { getValidationTeams, haveAllRequiredReportersReported } from './game-result-service'

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

describe('games/game-result-service/haveAllRequiredReportersReported', () => {
  test('does NOT consider a 2v2 matchmaking game fully reported when a diverged player reported but a real (non-diverged) reporter is still missing', () => {
    // Regression test for the "count vs identity" bug: p4 is diverged, and its report alone used to
    // be able to satisfy the gate on p3's behalf (both being non-null reports, count-wise), even
    // though p3 (a required, non-diverged reporter) never reported anything.
    const p4 = makeSbUserId(4)
    const allHumans = [p1, p2, p3, p4]
    const diverged = new Set([p4])
    // p1, p2, and p4 (the diverged player) have reported; p3 (required, non-diverged) has not.
    const reported = new Set([p1, p2, p4])

    expect(haveAllRequiredReportersReported(allHumans, diverged, reported)).toBe(false)
  })

  test('considers the game fully reported once the missing non-diverged reporter (p3) reports', () => {
    const p4 = makeSbUserId(4)
    const allHumans = [p1, p2, p3, p4]
    const diverged = new Set([p4])
    // Now p3 has also reported; the diverged player p4 still isn't required.
    const reported = new Set([p1, p2, p3])

    expect(haveAllRequiredReportersReported(allHumans, diverged, reported)).toBe(true)
  })

  test('does not require a diverged player to report at all', () => {
    const p4 = makeSbUserId(4)
    const allHumans = [p1, p2, p3, p4]
    const diverged = new Set([p4])
    const reported = new Set([p1, p2, p3])

    expect(haveAllRequiredReportersReported(allHumans, diverged, reported)).toBe(true)
  })

  test('requires every human when there are no diverged players', () => {
    expect(haveAllRequiredReportersReported([p1, p2], new Set(), new Set([p1]))).toBe(false)
    expect(haveAllRequiredReportersReported([p1, p2], new Set(), new Set([p1, p2]))).toBe(true)
  })
})
