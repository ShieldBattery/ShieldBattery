import { findUserIdsForNames } from '../models/users'
import transact from '../db/transaction'
import { createGameRecord } from '../models/games'
import { createGameUserRecord } from '../models/games-users'
import { genResultCode } from './gen-result-code'

// TODO(tec27): Make some constants somewhere for game sources

/**
 * Registers a game in the database so that results can be collected for it.
 *
 * @param mapId the ID of the map being played on, as stored in the `uploaded_maps` table
 * @param gameSource a string representing the source of the game, e.g. 'MATCHMAKING' or 'LOBBY'
 * @param gameConfig an object describing the configuration of the game in the format:
 *   `{ gameType, gameSubType, teams: [ [team1Players], [team2Players], ...] }`
 *   For games that begin teamless, all players may be on a single team. Entries in the team lists
 *   are in the format `{ name, race = (p,r,t,z), isComputer }`.
 * @param startTime the time the game is being started at. Optional, defaults to the current time.
 *
 * @returns an object containing the generated `gameId` and a map of `resultCodes` indexed by
 *   player name
 */
export async function registerGame(mapId, gameSource, gameConfig, startTime = new Date()) {
  const humanPlayers = gameConfig.teams.reduce((r, team) => {
    const humans = team.filter(p => !p.isComputer)
    r.push(...humans)
    return r
  }, [])
  const humanNames = humanPlayers.map(p => p.name)
  const userIdsMap = await findUserIdsForNames(humanNames)
  for (const name of humanNames) {
    if (!userIdsMap.has(name)) {
      throw new RangeError('Invalid human player: ' + name)
    }
  }

  const configToStore = {
    gameType: gameConfig.gameType,
    gameSubType: gameConfig.gameSubType,
    teams: gameConfig.teams.map(team =>
      team.map(p => ({
        id: p.isComputer ? -1 : userIdsMap.get(p.name),
        race: p.race,
        isComputer: p.isComputer,
      })),
    ),
    gameSource,
  }

  const resultCodes = new Map(humanNames.map(name => [name, genResultCode()]))

  let gameId

  await transact(async client => {
    gameId = await createGameRecord(client, { startTime, mapId, gameConfig: configToStore })
    await Promise.all(
      humanPlayers.map(p =>
        createGameUserRecord(client, {
          userId: userIdsMap.get(p.name),
          gameId,
          startTime,
          selectedRace: p.race,
          resultCode: resultCodes.get(p.name),
        }),
      ),
    )
  })

  return { gameId, resultCodes }
}
