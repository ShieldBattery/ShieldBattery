import { describe, expect, test } from 'vitest'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { GameRecord } from '../../../common/games/games'
import { LobbyVisibility } from '../../../common/lobbies/lobby-visibility'
import { makeSbMapId } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { canUserAccessReplay } from './replay-access'

const USER = makeSbUserId(1)
const OTHER_USER = makeSbUserId(2)

/** Builds a `GameRecord` with placeholder values for the fields `canUserAccessReplay` ignores. */
function makeGameRecord(config: GameConfig): GameRecord {
  return {
    id: 'game-1',
    startTime: new Date(),
    mapId: makeSbMapId('map-1'),
    config,
    disputable: false,
    disputeRequested: false,
    disputeReviewed: false,
    gameLength: null,
    results: null,
    selectedMatchup: null,
    assignedMatchup: null,
  }
}

function matchmakingConfig(): GameConfig {
  return {
    gameType: GameType.OneVsOne,
    gameSubType: 0,
    gameSource: GameSource.Matchmaking,
    gameSourceExtra: { type: MatchmakingType.Match1v1 },
    teams: [
      [{ id: USER, race: 'z', isComputer: false }],
      [{ id: OTHER_USER, race: 't', isComputer: false }],
    ],
  }
}

function lobbyConfig({
  visibility,
  observers,
  includeComputer = false,
}: {
  visibility?: LobbyVisibility
  observers?: ReturnType<typeof makeSbUserId>[]
  includeComputer?: boolean
} = {}): GameConfig {
  return {
    gameType: GameType.Melee,
    gameSubType: 0,
    gameSource: GameSource.Lobby,
    gameSourceExtra: {
      host: USER,
      visibility,
    },
    observers,
    lockedAlliances: false,
    teams: [
      [
        { id: USER, race: 'z', isComputer: false },
        ...(includeComputer ? [{ id: makeSbUserId(0), race: 't' as const, isComputer: true }] : []),
      ],
      [{ id: OTHER_USER, race: 't', isComputer: false }],
    ],
  }
}

describe('canUserAccessReplay', () => {
  test('matchmaking games are accessible to a logged-in user', () => {
    const game = makeGameRecord(matchmakingConfig())
    expect(canUserAccessReplay(game, makeSbUserId(999))).toBe(true)
  })

  test('matchmaking games are accessible without a user', () => {
    const game = makeGameRecord(matchmakingConfig())
    expect(canUserAccessReplay(game, undefined)).toBe(true)
  })

  test('listed lobby games are accessible to a non-participant', () => {
    const game = makeGameRecord(lobbyConfig({ visibility: 'listed' }))
    expect(canUserAccessReplay(game, makeSbUserId(999))).toBe(true)
  })

  test('listed lobby games are accessible without a user', () => {
    const game = makeGameRecord(lobbyConfig({ visibility: 'listed' }))
    expect(canUserAccessReplay(game, undefined)).toBe(true)
  })

  test('unlisted lobby games are accessible to a team participant', () => {
    const game = makeGameRecord(lobbyConfig({ visibility: 'unlisted' }))
    expect(canUserAccessReplay(game, USER)).toBe(true)
  })

  test('unlisted lobby games are accessible to an observer', () => {
    const observerId = makeSbUserId(3)
    const game = makeGameRecord(lobbyConfig({ visibility: 'unlisted', observers: [observerId] }))
    expect(canUserAccessReplay(game, observerId)).toBe(true)
  })

  test('unlisted lobby games are not accessible to a non-participant', () => {
    const game = makeGameRecord(lobbyConfig({ visibility: 'unlisted' }))
    expect(canUserAccessReplay(game, makeSbUserId(999))).toBe(false)
  })

  test('unlisted lobby games are not accessible without a user', () => {
    const game = makeGameRecord(lobbyConfig({ visibility: 'unlisted' }))
    expect(canUserAccessReplay(game, undefined)).toBe(false)
  })

  test('lobby games with no visibility field are accessible to a team participant', () => {
    const game = makeGameRecord(lobbyConfig())
    expect(canUserAccessReplay(game, USER)).toBe(true)
  })

  test('lobby games with no visibility field are accessible to an observer', () => {
    const observerId = makeSbUserId(3)
    const game = makeGameRecord(lobbyConfig({ observers: [observerId] }))
    expect(canUserAccessReplay(game, observerId)).toBe(true)
  })

  test('lobby games with no visibility field are not accessible to a non-participant', () => {
    const game = makeGameRecord(lobbyConfig())
    expect(canUserAccessReplay(game, makeSbUserId(999))).toBe(false)
  })

  test('a computer slot does not grant access to a non-participant sharing its id', () => {
    const game = makeGameRecord(lobbyConfig({ visibility: 'unlisted', includeComputer: true }))
    // Computers are always assigned id 0, so a non-participant with that same id must not be
    // granted access via the computer's slot.
    expect(canUserAccessReplay(game, makeSbUserId(0))).toBe(false)
  })
})
