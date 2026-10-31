import { DbClient } from '../db'
import { sql } from '../db/sql'

/**
 * Rewrites a game's `matchup_sides` rows from its current `games_users` and rating change rows.
 * Must run after both of those are written for the game's latest results. A game whose results
 * don't describe two complete sides (disputed, unrated, or missing teams) is left with no rows,
 * so this is correct to call on every result change, not only the ones that produce a matchup.
 */
export async function refreshMatchupSides(client: DbClient, gameId: string): Promise<void> {
  await client.query(sql`SELECT refresh_matchup_sides(${[gameId]}::uuid[])`)
}
