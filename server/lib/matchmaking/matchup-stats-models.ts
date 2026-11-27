import { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'

/** Arbitrary key for the advisory lock that keeps two refreshes of the matchup stats apart. */
const MATCHUP_STATS_LOCK_KEY = 5_208_914_377

/** How many of the most recent seasons get recomputed on each refresh. */
const REFRESHED_SEASONS = 2

/** Games shorter than this are left out of matchup records. */
const MIN_COUNTED_GAME_LENGTH_MS = 2 * 60 * 1000

export interface MatchupStatsRefreshResult {
  /** Whether the refresh recomputed every season rather than just the most recent ones. */
  full: boolean
}

/**
 * Recomputes `user_matchup_stats` and `ladder_matchup_stats` from `games` for the current and
 * previous season, where results can still change (late reports, disputes, manual resolution).
 * Older seasons are kept as they are. If no stats exist yet, every season is computed instead.
 *
 * @returns the result of the refresh, or `undefined` if another refresh was already in progress
 */
export async function refreshMatchupStats(
  asOf: Date,
  { full: forceFull = false }: { full?: boolean } = {},
): Promise<MatchupStatsRefreshResult | undefined> {
  return await transact(async client => {
    const lockResult = await client.query<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${MATCHUP_STATS_LOCK_KEY}) AS locked`,
    )
    if (!lockResult.rows[0].locked) {
      return undefined
    }

    const existingResult = await client.query<{ exists: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM ladder_matchup_stats) AS exists`,
    )
    const full = forceFull || !existingResult.rows[0].exists

    const seasonsResult = await client.query<{ id: number }>(sql`
      SELECT id
      FROM matchmaking_seasons
      WHERE start_date AT TIME ZONE 'UTC' <= ${asOf}
      ORDER BY start_date DESC
      ${full ? sql`` : sql`LIMIT ${REFRESHED_SEASONS}`}
    `)
    const seasonIds = seasonsResult.rows.map(r => r.id)

    await client.query(sql`DELETE FROM user_matchup_stats WHERE season_id = ANY(${seasonIds})`)
    await client.query(sql`DELETE FROM ladder_matchup_stats WHERE season_id = ANY(${seasonIds})`)
    if (seasonIds.length) {
      await writeCountedSides(client, asOf, seasonIds)
      await client.query(sql`
        INSERT INTO user_matchup_stats (
          user_id, matchmaking_type, season_id, races, opponent_races, wins, losses
        )
        SELECT gu.user_id, s.matchmaking_type, s.season_id, s.races, s.opponent_races,
          count(*) FILTER (WHERE s.won), count(*) FILTER (WHERE NOT s.won)
        FROM counted_sides s
        INNER JOIN games_users gu ON gu.game_id = s.game_id AND gu.team = s.team
        GROUP BY 1, 2, 3, 4, 5
      `)
      await client.query(sql`
        INSERT INTO ladder_matchup_stats (
          matchmaking_type, season_id, races, opponent_races, wins, losses
        )
        SELECT matchmaking_type, season_id, races, opponent_races,
          count(*) FILTER (WHERE won), count(*) FILTER (WHERE NOT won)
        FROM counted_sides
        GROUP BY 1, 2, 3, 4
      `)
    }

    return { full }
  })
}

/**
 * Fills a transaction-scoped `counted_sides` table with one row per team of every game that counts
 * towards matchup records in the given seasons: the team's races, its opponents' races, and whether
 * it won. Both stats tables are grouped from it, so they can't disagree about which games count.
 */
async function writeCountedSides(client: DbClient, asOf: Date, seasonIds: number[]) {
  // A game counts when it's ranked, long enough to say something about the matchup, and its
  // roster reads as exactly two teams where one won and the other lost, with every player's team
  // and race known. Anything else (a draw, both sides claiming the win, a player without a team)
  // is left out whole rather than counted from part of its roster.
  await client.query(sql`
    CREATE TEMPORARY TABLE counted_sides (
      matchmaking_type matchmaking_type NOT NULL,
      season_id integer NOT NULL,
      game_id uuid NOT NULL,
      team smallint NOT NULL,
      races text NOT NULL,
      opponent_races text NOT NULL,
      won boolean NOT NULL
    ) ON COMMIT DROP
  `)
  await client.query(sql`
    INSERT INTO counted_sides (
      matchmaking_type, season_id, game_id, team, races, opponent_races, won
    )
    WITH seasons AS (
      SELECT id, start_date AT TIME ZONE 'UTC' AS start_date,
        LEAD(start_date AT TIME ZONE 'UTC') OVER (ORDER BY start_date) AS end_date
      FROM matchmaking_seasons
    ),
    counted_games AS (
      SELECT g.id, s.id AS season_id,
        (g.config->'gameSourceExtra'->>'type')::matchmaking_type AS matchmaking_type
      FROM games g
      INNER JOIN seasons s
        ON g.start_time >= s.start_date AND (s.end_date IS NULL OR g.start_time < s.end_date)
      WHERE s.id = ANY(${seasonIds})
        AND g.config->>'gameSource' = 'MATCHMAKING'
        AND g.config->'gameSourceExtra'->>'type' IS NOT NULL
        AND g.canceled_at IS NULL
        AND jsonb_typeof(g.results) = 'array'
        AND g.game_length >= ${MIN_COUNTED_GAME_LENGTH_MS}
        AND g.start_time <= ${asOf}
        AND (
          SELECT
            bool_and(
              gu.result IN ('win', 'loss') AND gu.team IS NOT NULL AND
                gu.assigned_race IN ('p', 't', 'z')
            )
            AND count(DISTINCT gu.team) = 2
            AND count(DISTINCT gu.team) FILTER (WHERE gu.result = 'win') = 1
            AND count(DISTINCT gu.team) FILTER (WHERE gu.result = 'loss') = 1
          FROM games_users gu
          WHERE gu.game_id = g.id
        )
    ),
    sides AS (
      SELECT gu.game_id, gu.team,
        string_agg(gu.assigned_race::text, '' ORDER BY gu.assigned_race::text COLLATE "C")
          AS races,
        bool_or(gu.result = 'win') AS won
      FROM counted_games cg
      INNER JOIN games_users gu ON gu.game_id = cg.id
      GROUP BY gu.game_id, gu.team
    )
    SELECT cg.matchmaking_type, cg.season_id, s.game_id, s.team, s.races,
      o.races AS opponent_races, s.won
    FROM counted_games cg
    INNER JOIN sides s ON s.game_id = cg.id
    INNER JOIN sides o ON o.game_id = cg.id AND o.team <> s.team
  `)
}
