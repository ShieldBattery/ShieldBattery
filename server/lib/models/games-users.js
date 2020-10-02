import db from '../db'
import sql from 'sql-template-strings'

/**
 * Creates a new user-specific game record in the `games_users` table. All values that are reported
 * post-game will have default values. This is meant to be inside a transaction while also creating
 * the record for the game itself.
 */
export async function createGameUserRecord(
  client,
  { userId, gameId, startTime, selectedRace, resultCode },
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
export async function deleteUserRecordsForGame(gameId) {
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
 * @param userId
 * @param gameId
 *
 * @returns an object containing the information about the game, or null if there is no such game
 */
export async function getUserGameRecord(userId, gameId) {
  const { client, done } = await db()

  try {
    const result = await client.query(
      sql`SELECT * FROM games_users WHERE user_id = ${userId} AND game_id = ${gameId}`,
    )
    if (!result.rows.length) {
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
 *
 * Results should be an array of entries containing [playerName, resultCode], where resultCode can
 * be:
 *
 * - 0: playing
 * - 1: disconnected
 * - 2: victory
 * - 3: defeat
 */
export async function setReportedResults({ userId, gameId, reportedResults, reportedAt }) {
  const { client, done } = await db()

  try {
    await client.query(sql`
      UPDATE games_users
      SET
        reported_results = ${JSON.stringify(reportedResults)},
        reported_at = ${reportedAt}
      WHERE user_id = ${userId} AND game_id = ${gameId}
    `)
  } finally {
    done()
  }
}
