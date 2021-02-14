import { GameConfig, GameConfigPlayerName, GameSource } from '../../../common/games/configuration'
import { makeSbUserId } from '../../../common/users/user-info'
import transact from '../db/transaction'
import { createGameUserRecord } from '../models/games-users'
import { findUsersByName } from '../users/user-model'
import { createGameRecord } from './game-models'
import { genResultCode } from './gen-result-code'

/**
 * Registers a game in the database so that results can be collected for it.
 *
 * @param mapId the ID of the map being played on, as stored in the `uploaded_maps` table
 * @param gameSource a string representing the source of the game, e.g. 'MATCHMAKING' or 'LOBBY'
 * @param gameSourceExtra extra information about the source of the game, such as the matchmaking
 *   type
 * @param gameConfig an object describing the configuration of the game
 * @param startTime the time the game is being started at. Optional, defaults to the current time.
 *
 * @returns an object containing the generated `gameId` and a map of `resultCodes` indexed by
 *   player name
 */
export async function registerGame(
  mapId: string,
  gameSource: GameSource,
  gameSourceExtra: string | undefined,
  gameConfig: Omit<GameConfig<GameConfigPlayerName>, 'gameSource' | 'gameSourceExtra'>,
  startTime = new Date(),
) {
  const humanPlayers = gameConfig.teams.reduce((r, team) => {
    const humans = team.filter(p => !p.isComputer)
    r.push(...humans)
    return r
  }, [])
  const humanNames = humanPlayers.map(p => p.name)
  const usersMap = await findUsersByName(humanNames)
  for (const name of humanNames) {
    if (!usersMap.has(name)) {
      throw new RangeError('Invalid human player: ' + name)
    }
  }

  const configToStore = {
    gameType: gameConfig.gameType,
    gameSubType: gameConfig.gameSubType,
    teams: gameConfig.teams.map(team =>
      team.map(p => ({
        id: p.isComputer ? makeSbUserId(-1) : usersMap.get(p.name)!.id,
        race: p.race,
        isComputer: p.isComputer,
      })),
    ),
    gameSource,
    gameSourceExtra,
  }

  const resultCodes = new Map(humanNames.map(name => [name, genResultCode()]))

  // NOTE(tec27): the value here makes the linter happy, but this will actually be set in the
  // transaction below
  let gameId = ''

  await transact(async client => {
    gameId = await createGameRecord(client, { startTime, mapId, config: configToStore })
    await Promise.all(
      humanPlayers.map(p =>
        createGameUserRecord(client, {
          userId: usersMap.get(p.name)!.id,
          gameId,
          startTime,
          selectedRace: p.race,
          resultCode: resultCodes.get(p.name)!,
        }),
      ),
    )
  })

  return { gameId, resultCodes }
}
