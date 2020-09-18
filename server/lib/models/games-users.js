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
