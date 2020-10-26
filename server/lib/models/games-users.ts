import db, { DbClient } from '../db'
import sql from 'sql-template-strings'
import { GameClientPlayerResult, ReconciledResult } from '../../../common/game-results'
import { AssignedRaceChar, RaceChar } from '../../../common/races'

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
      assigned_race, result
    ) VALUES (
      ${userId}, ${gameId}, ${startTime}, ${selectedRace}, ${resultCode}, NULL, NULL,
      NULL, NULL
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
