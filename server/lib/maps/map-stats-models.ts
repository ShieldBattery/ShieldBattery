import { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'

/** Arbitrary key for the advisory lock that keeps two refreshes of the map stats from overlapping. */
const MAP_STATS_LOCK_KEY = 7_316_040_812

/** How many of the most recent seasons get their matchup stats recomputed on each refresh. */
const REFRESHED_SEASONS = 2
/** How many trailing UTC days (besides the current one) get recomputed on each refresh. */
const REFRESHED_DAYS = 7

/** Games shorter than this are left out of matchup winrates. */
const MIN_DECIDED_GAME_LENGTH_MS = 2 * 60 * 1000

/**
 * Matches games (aliased `g`) that were actually played on their map. Games without results
 * requirements (against computers, or with a single player) never receive results, so for those
 * not being canceled is the only signal available.
 */
const PLAYED_GAME = sql`
  g.canceled_at IS NULL AND (
    jsonb_typeof(g.results) = 'array' OR (g.config->>'resultsExempt')::boolean IS TRUE
  )
`

export interface MapStatsRefreshResult {
  /** Whether the refresh recomputed all of history rather than just recent windows. */
  full: boolean
}

/**
 * Recomputes the map stats tables from `games`. The per-map snapshot is always recomputed in full.
 * The daily rows of the last few days and the matchup rows of the current and previous season are
 * recomputed, since results can still change there (late reports, disputes); older rows are kept.
 * If no stats exist yet, all of history is computed instead.
 *
 * @returns the result of the refresh, or `undefined` if another refresh was already in progress
 */
export async function refreshMapStats(
  asOf: Date,
  { full: forceFull = false }: { full?: boolean } = {},
): Promise<MapStatsRefreshResult | undefined> {
  return await transact(async client => {
    const lockResult = await client.query<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${MAP_STATS_LOCK_KEY}) AS locked`,
    )
    if (!lockResult.rows[0].locked) {
      return undefined
    }

    const existingResult = await client.query<{ exists: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM map_stats) AS exists`,
    )
    const full = forceFull || !existingResult.rows[0].exists

    await refreshSnapshot(client, asOf)
    await refreshDaily(client, asOf, full)
    await refreshMatchups(client, asOf, full)

    return { full }
  })
}

async function refreshSnapshot(client: DbClient, asOf: Date) {
  await client.query(sql`DELETE FROM map_stats`)
  await client.query(sql`
    WITH played AS (
      SELECT g.id, g.map_id, g.start_time, g.game_length,
        g.start_time >= ${asOf}::timestamptz - interval '90 days' AS in_90d
      FROM games g
      INNER JOIN maps m ON m.id = g.map_id
      WHERE ${PLAYED_GAME} AND g.start_time <= ${asOf}
    ),
    players AS (
      SELECT p.map_id, count(DISTINCT gu.user_id) AS players
      FROM played p
      INNER JOIN games_users gu ON gu.game_id = p.id
      WHERE p.in_90d
      GROUP BY p.map_id
    )
    INSERT INTO map_stats (
      map_id, games_7d, games_28d, games_90d, players_90d, games_total, median_length_90d,
      last_played_at, updated_at
    )
    SELECT p.map_id,
      count(*) FILTER (WHERE p.start_time >= ${asOf}::timestamptz - interval '7 days'),
      count(*) FILTER (WHERE p.start_time >= ${asOf}::timestamptz - interval '28 days'),
      count(*) FILTER (WHERE p.in_90d),
      COALESCE(pl.players, 0),
      count(*),
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY p.game_length)
        FILTER (WHERE p.in_90d AND p.game_length IS NOT NULL)),
      max(p.start_time),
      ${asOf}
    FROM played p
    LEFT JOIN players pl ON pl.map_id = p.map_id
    GROUP BY p.map_id, pl.players
  `)
}

async function refreshDaily(client: DbClient, asOf: Date, full: boolean) {
  const firstDay = sql`((${asOf}::timestamptz AT TIME ZONE 'UTC')::date - ${REFRESHED_DAYS}::integer)`

  await client.query(
    full
      ? sql`DELETE FROM map_stats_daily`
      : sql`DELETE FROM map_stats_daily WHERE day >= ${firstDay}`,
  )
  await client.query(sql`
    INSERT INTO map_stats_daily (map_id, day, game_source, game_type, games, player_games)
    SELECT g.map_id, (g.start_time AT TIME ZONE 'UTC')::date AS day,
      g.config->>'gameSource', g.config->>'gameType', count(*), sum(gu.players)
    FROM games g
    INNER JOIN maps m ON m.id = g.map_id
    CROSS JOIN LATERAL (
      SELECT count(*) AS players FROM games_users WHERE game_id = g.id
    ) gu
    WHERE ${PLAYED_GAME}
      AND g.config->>'gameSource' IS NOT NULL
      AND g.config->>'gameType' IS NOT NULL
      AND g.start_time <= ${asOf}
      ${full ? sql`` : sql`AND g.start_time >= ${firstDay}::timestamp AT TIME ZONE 'UTC'`}
    GROUP BY 1, 2, 3, 4
  `)
}

async function refreshMatchups(client: DbClient, asOf: Date, full: boolean) {
  const seasonsResult = await client.query<{ id: number }>(sql`
    SELECT id
    FROM matchmaking_seasons
    WHERE start_date <= ${asOf}
    ORDER BY start_date DESC
    ${full ? sql`` : sql`LIMIT ${REFRESHED_SEASONS}`}
  `)
  const seasonIds = seasonsResult.rows.map(r => r.id)

  await client.query(sql`DELETE FROM map_matchup_stats WHERE season_id = ANY(${seasonIds})`)
  if (!seasonIds.length) {
    return
  }

  // A game is decided when it has exactly one winning team, every other team lost, and every
  // player's team and race are known. Each side of a matchup string is one team's sorted races, so
  // the winning team's races say which side won.
  await client.query(sql`
    WITH seasons AS (
      SELECT id, start_date, LEAD(start_date) OVER (ORDER BY start_date) AS end_date
      FROM matchmaking_seasons
      WHERE start_date <= ${asOf}
    ),
    decided AS (
      SELECT g.map_id, s.id AS season_id,
        (g.config->'gameSourceExtra'->>'type')::matchmaking_type AS matchmaking_type,
        g.assigned_matchup AS matchup,
        split_part(g.assigned_matchup, '-', 1) AS left_races,
        split_part(g.assigned_matchup, '-', 2) AS right_races,
        r.winner_races
      FROM games g
      INNER JOIN maps m ON m.id = g.map_id
      INNER JOIN seasons s
        ON g.start_time >= s.start_date AND (s.end_date IS NULL OR g.start_time < s.end_date)
      CROSS JOIN LATERAL (
        SELECT string_agg(gu.assigned_race::text, '' ORDER BY gu.assigned_race::text COLLATE "C")
            FILTER (WHERE gu.result = 'win') AS winner_races
        FROM games_users gu
        WHERE gu.game_id = g.id
        HAVING
          bool_and(gu.result IN ('win', 'loss') AND gu.team IS NOT NULL AND
            gu.assigned_race IS NOT NULL)
          AND count(DISTINCT gu.team) FILTER (WHERE gu.result = 'win') = 1
          AND count(DISTINCT gu.team) FILTER (WHERE gu.result = 'loss') =
            count(DISTINCT gu.team) - 1
      ) r
      WHERE s.id = ANY(${seasonIds})
        AND g.config->>'gameSource' = 'MATCHMAKING'
        AND g.config->'gameSourceExtra'->>'type' IS NOT NULL
        AND g.canceled_at IS NULL
        AND jsonb_typeof(g.results) = 'array'
        AND g.assigned_matchup ~ '^[a-z]+-[a-z]+$'
        AND g.game_length >= ${MIN_DECIDED_GAME_LENGTH_MS}
        AND g.start_time <= ${asOf}
    )
    INSERT INTO map_matchup_stats (
      map_id, season_id, matchmaking_type, matchup, games, left_wins, right_wins
    )
    SELECT map_id, season_id, matchmaking_type, matchup, count(*),
      count(*) FILTER (WHERE left_races <> right_races AND winner_races = left_races),
      count(*) FILTER (WHERE left_races <> right_races AND winner_races = right_races)
    FROM decided
    WHERE winner_races IN (left_races, right_races)
    GROUP BY 1, 2, 3, 4
  `)
}
