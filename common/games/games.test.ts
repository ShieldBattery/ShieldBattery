import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { makeSbMapId } from '../maps'
import { MatchmakingType } from '../matchmaking'
import { makeSbUserId } from '../users/sb-user-id'
import { GameConfig, GameSource } from './configuration'
import { GameType } from './game-type'
import { GameRecordJson, getGameTypeLabel } from './games'

/** Returns each string's default text with its `{{placeholders}}` filled in. */
const t = ((_key: string, defaultOrOptions: unknown) => {
  const options = (typeof defaultOrOptions === 'object' ? defaultOrOptions : {}) as Record<
    string,
    unknown
  >
  const text =
    typeof defaultOrOptions === 'string' ? defaultOrOptions : String(options.defaultValue)
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options[name] ?? ''))
}) as unknown as TFunction

function makeGame(config: GameConfig): GameRecordJson {
  return {
    id: 'game-1',
    startTime: 0,
    mapId: makeSbMapId('map-1'),
    config,
    disputable: false,
    disputeRequested: false,
    disputeReviewed: false,
    gameLength: null,
    results: null,
    selectedMatchup: null,
    assignedMatchup: null,
    manuallyResolved: false,
  }
}

const TEAMS = [[{ id: makeSbUserId(1), race: 'z' as const, isComputer: false }]]

describe('common/games/games/getGameTypeLabel', () => {
  test('labels a lobby game as a custom game', () => {
    const game = makeGame({
      gameSource: GameSource.Lobby,
      gameType: GameType.Melee,
      gameSubType: 0,
      teams: TEAMS,
    })
    expect(getGameTypeLabel(game, t)).toBe('Custom game')
  })

  test('labels a matchmaking game with its type', () => {
    const game = makeGame({
      gameSource: GameSource.Matchmaking,
      gameSourceExtra: { type: MatchmakingType.Match1v1 },
      gameType: GameType.OneVsOne,
      gameSubType: 0,
      teams: TEAMS,
    })
    expect(getGameTypeLabel(game, t)).toBe('Ranked 1v1')
  })

  test('labels a solo game as one', () => {
    const game = makeGame({
      gameSource: GameSource.Solo,
      gameType: GameType.UseMapSettings,
      gameSubType: 0,
      teams: [TEAMS[0], [{ id: makeSbUserId(0), race: 't', isComputer: true }]],
    })
    expect(getGameTypeLabel(game, t)).toBe('Solo game')
  })
})
