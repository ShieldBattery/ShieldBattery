import db, { DbClient } from '../db'
import sql from 'sql-template-strings'
import { GameClientPlayerResult, ReconciledResult } from '../../../common/game-results'
import { AssignedRaceChar, RaceChar } from '../../../common/races'
import { ReconciledPlayerResult, ResultSubmission } from '../games/results'

export interface ReportedResultsData {
  userId: number
  gameId: string
  reportedAt: Date
  reportedResults: {
    /** The elapsed time of the game, in milliseconds. */
    time: number
    /** A tuple of (userId, result info). */
    playerResults: Array<[number, GameClientPlayerResult]>
  }
}

export interface DbGameUser {
  userId: number
  gameId: string
  startTime: Date
  selectedRace: RaceChar
  resultCode: string
  reportedResults: ReportedResultsData | null
  reportedAt: Date | null
  assignedRace: AssignedRaceChar | null
  result: ReconciledResult | null
  apm: number | null
}

export type CreateGameUserRecordData = Pick<
  DbGameUser,
  'userId' | 'gameId' | 'startTime' | 'selectedRace' | 'resultCode'
>

/**
 * Creates a new user-specific game record in the `games_users` table. All values that are reported
 * post-game will have default values. This is meant to be inside a transaction while also creating
 * the record for the game itself.
 */
export async function createGameUserRecord(
  client: DbClient,
  { userId, gameId, startTime, selectedRace, resultCode }: CreateGameUserRecordData,
) {
  return client.query(sql`
    INSERT INTO games_users (
      user_id, game_id, start_time, selected_race, result_code, reported_results, reported_at,
      assigned_race, result, apm
    ) VALUES (
      ${userId}, ${gameId}, ${startTime}, ${selectedRace}, ${resultCode}, NULL, NULL,
      NULL, NULL, NULL
    )
  `)
}

/**
 * Deletes all user-specific records for a particular game.
 */
export async function deleteUserRecordsForGame(gameId: string): Promise<void> {
  const { client, done } = await db()

  try {
    await client.query(sql`DELETE FROM games_users WHERE game_id = ${gameId}`)
  } finally {
    done()
  }
}

/**
 * Retrieves a particular user-specific game record.
 *
 * @returns an object containing the information about the game, or null if there is no such game
 */
export async function getUserGameRecord(
  userId: number,
  gameId: string,
): Promise<DbGameUser | null> {
  const { client, done } = await db()

  try {
    const result = await client.query(
      sql`SELECT * FROM games_users WHERE user_id = ${userId} AND game_id = ${gameId}`,
    )
    if (!result.rowCount) {
      return null
    }

    const row = result.rows[0]

    return {
      userId: row.user_id,
      gameId: row.game_id,
      startTime: row.start_time,
      selectedRace: row.selected_race,
      resultCode: row.result_code,
      reportedResults: row.reported_results,
      reportedAt: row.reported_at,
      assignedRace: row.assignedRace,
      result: row.result,
      apm: row.apm,
    }
  } finally {
    done()
  }
}

/**
 * Updates a particular user's results for a game.
 */
export async function setReportedResults({
  userId,
  gameId,
  reportedResults,
  reportedAt,
}: ReportedResultsData) {
  const { client, done } = await db()

  try {
    await client.query(sql`
      UPDATE games_users
      SET
        reported_results = ${reportedResults},
        reported_at = ${reportedAt}
      WHERE user_id = ${userId} AND game_id = ${gameId}
    `)
  } finally {
    done()
  }
}

/**
 * Gets the current reported results for all the users in a game.
 */
export async function getCurrentReportedResults(
  gameId: string,
): Promise<Array<ResultSubmission | null>> {
  const { client, done } = await db()

  try {
    const result = await client.query(sql`
      SELECT user_id, reported_results
      FROM games_users
      WHERE game_id = ${gameId}
      ORDER_BY reported_at DESC
    `)

    return result.rows.map(row =>
      row.reportedResults
        ? {
            reporter: row.user_id,
            time: row.reported_results.time,
            playerResults: row.reported_results.playerResults,
          }
        : null,
    )
  } finally {
    done()
  }
}

/**
 * Sets the reconciled (and probably final) result for a particular user in a game. This is intended
 * to be executed in a transaction that updates all the users and the full game results at once.
 */
export async function setUserReconciledResult(
  client: DbClient,
  userId: number,
  gameId: string,
  result: ReconciledPlayerResult,
) {
  return client.query(sql`
    UPDATE games_users
    SET
      assigned_race = ${result.race},
      result = ${result.result},
      apm = ${result.apm}
    WHERE user_id = ${userId} AND game_id = ${gameId}
  `)
}
