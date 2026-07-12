import { GameConfig, GameSource } from '../../../common/games/configuration'
import {
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  getTeamSizeForFormat,
  MatchupFilter,
} from '../../../common/games/game-filters'
import { GameRecord } from '../../../common/games/games'
import { expandMatchupFilter, MatchupString } from '../../../common/games/matchups'
import { NetcodeV2RelayEvent } from '../../../common/games/netcode-v2'
import { ReconciledResults } from '../../../common/games/results'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { escapeSearchString } from '../db/escape-search-string'
import { sql, sqlConcat, sqlRaw } from '../db/sql'
import { Dbify } from '../db/types'

type DbGameRecord = Dbify<GameRecord>

export type CreateGameRecordData = Pick<
  GameRecord,
  'startTime' | 'mapId' | 'config' | 'selectedMatchup'
>

function convertFromDb(row: DbGameRecord): GameRecord {
  return {
    id: row.id,
    startTime: row.start_time,
    mapId: row.map_id,
    config: row.config,
    disputable: row.disputable,
    disputeRequested: row.dispute_requested,
    disputeReviewed: row.dispute_reviewed,
    gameLength: row.game_length,
    // Some legacy rows store `results` as an empty object `{}` rather than an array (or null);
    // normalize those to null so the runtime value matches the declared type and downstream
    // consumers (e.g. `new Map(results)`) don't choke on a non-iterable.
    results: Array.isArray(row.results) ? row.results : null,
    selectedMatchup: row.selected_matchup,
    assignedMatchup: row.assigned_matchup,
  }
}

/**
 * Creates a new record in the `games` table using the specified client. This is intended to be used
 * inside a transaction while also creating records for each user's game results.
 */
export async function createGameRecord(
  client: DbClient,
  { startTime, mapId, config, selectedMatchup }: CreateGameRecordData,
): Promise<string> {
  // TODO(tec27): We could make some type of TransactionClient transformation to enforce this is
  // done in a transaction
  const result = await client.query<{ id: string }>(sql`
    INSERT INTO games (
      start_time, map_id, config, disputable, dispute_requested, dispute_reviewed, game_length,
      selected_matchup
    ) VALUES (
      ${startTime}, ${mapId}, ${config}, FALSE, FALSE, FALSE, NULL,
      ${selectedMatchup}
    ) RETURNING id
  `)

  return result.rows[0].id
}

/**
 * Returns a `GameRecord` for the specificied ID, or `undefined` if one could not be found.
 */
export async function getGameRecord(gameId: string): Promise<GameRecord | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbGameRecord>(sql`
      SELECT id, start_time, map_id, config, disputable, dispute_requested, dispute_reviewed,
        game_length, results, selected_matchup, assigned_matchup
      FROM games
      WHERE id = ${gameId}`)
    return result.rowCount ? convertFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Deletes a record from the `games` table. This should likely be accompanied by deleting the
 * user-specific result rows in `games_users`.
 */
export async function deleteRecordForGame(gameId: string): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`DELETE FROM games WHERE id = ${gameId}`)
  } finally {
    done()
  }
}

/**
 * Sets the reconciled (and probably final) result for a particular game. This is intended
 * to be executed in a transaction that updates all the users and the full game results at once.
 */
export async function setReconciledResult(
  client: DbClient,
  gameId: string,
  results: ReconciledResults,
  assignedMatchup: MatchupString | null,
): Promise<void> {
  await client.query(sql`
    UPDATE games
    SET
      results = ${JSON.stringify(Array.from(results.results.entries()))},
      game_length = ${results.time},
      disputable = ${results.disputed},
      dispute_requested = false,
      dispute_reviewed = false,
      assigned_matchup = ${assignedMatchup}
    WHERE id = ${gameId}
  `)
}

/**
 * Persists the rally-point2 coordinator's session id for a netcode-v2 game, called right after the
 * coordinator's session/create call succeeds. Lets the reconciliation sweep later ask the
 * coordinator whether the session is still alive instead of blind-forcing after a timeout.
 */
export async function setNetcodeV2Session(gameId: string, session: number): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      UPDATE games
      SET netcode_v2_session = ${session}
      WHERE id = ${gameId}
    `)
  } finally {
    done()
  }
}

/**
 * Returns the rally-point2 coordinator session id persisted for a game, or `null` if the game has
 * none on record (not a netcode-v2 game, or the session id never persisted). Used by the in-game
 * re-home endpoint to confirm a request names a live netcode-v2 session before asking the
 * coordinator to move it.
 */
export async function getNetcodeV2Session(gameId: string): Promise<number | null> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ netcode_v2_session: string | null }>(sql`
      SELECT netcode_v2_session
      FROM games
      WHERE id = ${gameId}
    `)
    const raw = result.rows[0]?.netcode_v2_session
    // netcode_v2_session is a BIGINT, so pg returns it as a string; normalize to a number.
    return raw === null || raw === undefined ? null : Number(raw)
  } finally {
    done()
  }
}

/**
 * Appends relay-serving-history events to a game's `netcode_v2_relays` record: the session's serving
 * relay(s) at create time, or a later rehome that moved it to a replacement. A no-op for an empty
 * list, so callers can pass through a deduped/filtered set without a special-case guard.
 */
export async function addNetcodeV2RelayEvents(
  gameId: string,
  events: NetcodeV2RelayEvent[],
): Promise<void> {
  if (events.length === 0) {
    return
  }

  const { client, done } = await db()
  try {
    await client.query(sql`
      UPDATE games
      SET netcode_v2_relays = COALESCE(netcode_v2_relays, '[]'::jsonb) || ${JSON.stringify(events)}::jsonb
      WHERE id = ${gameId}
    `)
  } finally {
    done()
  }
}

/**
 * Returns a game's persisted netcode-v2 coordinator session id and relay-serving history, for the
 * admin debug view. `session` is `null` for a game that never persisted a coordinator session id
 * (not a netcode-v2 game, or the write failed); `relays` is empty when there's no history on record.
 */
export async function getNetcodeV2DebugInfo(
  gameId: string,
): Promise<{ session: number | null; relays: NetcodeV2RelayEvent[] }> {
  const { client, done } = await db()
  try {
    const result = await client.query<{
      netcode_v2_session: string | null
      netcode_v2_relays: NetcodeV2RelayEvent[] | null
    }>(sql`
      SELECT netcode_v2_session, netcode_v2_relays
      FROM games
      WHERE id = ${gameId}
    `)
    const row = result.rows[0]
    return {
      // netcode_v2_session is a BIGINT, so pg returns it as a string; normalize to a number.
      session: row?.netcode_v2_session != null ? Number(row.netcode_v2_session) : null,
      relays: row?.netcode_v2_relays ?? [],
    }
  } finally {
    done()
  }
}

/**
 * Overwrites a game's persisted config. Used for values that get decided after the game record is
 * first created — currently only `useNetcodeV2`, which depends on the netcode v2 feature flag and
 * the player count at load time, neither of which is known when the game is registered.
 */
export async function updateGameConfig(gameId: string, config: GameConfig): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      UPDATE games
      SET config = ${config}
      WHERE id = ${gameId}
    `)
  } finally {
    done()
  }
}

/**
 * Returns the number of games that have been completed (that is, have non-null results).
 */
export async function countCompletedGames(): Promise<number> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM games WHERE results IS NOT NULL;`,
    )
    return Number(result.rows[0].count)
  } finally {
    done()
  }
}

/**
 * Retrieves game information for the last `numGames` games of a user. The resulting array may be
 * empty or less than `numGames` in length if the user has not played that many games. This list
 * will also include games that have incomplete results or are disputed, but never a results-exempt
 * game (contains computer players — see `isResultsExempt`), which is never shown at all.
 */
export async function getRecentGamesForUser(
  userId: SbUserId,
  numGames: number,
): Promise<GameRecord[]> {
  // TODO(tec27): Support pagination on this

  const { client, done } = await db()
  try {
    const result = await client.query<DbGameRecord>(sql`
      SELECT g.*
      FROM games_users u JOIN games g ON u.game_id = g.id
      WHERE u.user_id = ${userId}
      AND (g.config->>'resultsExempt')::boolean IS NOT TRUE
      ORDER BY u.start_time DESC
      LIMIT ${numGames}
    `)
    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/**
 * Retrieves completed matchmaking games for the platform games list. Never returns a results-exempt
 * game (contains computer players — see `isResultsExempt`), though matchmaking never has computer
 * players in the first place.
 */
export async function getGames(
  params: {
    limit: number
    offset: number
    duration?: GameDurationFilter
    mapName?: string
    playerName?: string
    format?: GameFormat
    matchup?: MatchupFilter
    sort?: GameSortOption
  },
  withClient?: DbClient,
): Promise<GameRecord[]> {
  const { limit, offset, duration, mapName, playerName, format, matchup, sort } = params

  const { client, done } = await db(withClient)
  try {
    const whereClauses = [
      sql`g.config->>'gameSource' = ${GameSource.Matchmaking}`,
      sql`g.results IS NOT NULL`,
      // Matchmaking never has computer players, so this can't currently exclude anything — kept
      // for consistency/defense in depth with the other games-list surfaces.
      sql`(g.config->>'resultsExempt')::boolean IS NOT TRUE`,
    ]
    let needMapJoin = false

    if (duration && duration !== GameDurationFilter.All) {
      switch (duration) {
        case GameDurationFilter.Under10:
          whereClauses.push(sql`g.game_length < 600000`)
          break
        case GameDurationFilter.From10To20:
          whereClauses.push(sql`g.game_length >= 600000 AND g.game_length < 1200000`)
          break
        case GameDurationFilter.From20To30:
          whereClauses.push(sql`g.game_length >= 1200000 AND g.game_length < 1800000`)
          break
        case GameDurationFilter.Over30:
          whereClauses.push(sql`g.game_length >= 1800000`)
          break
        default:
          duration satisfies never
      }
    }

    if (mapName) {
      needMapJoin = true
      whereClauses.push(sql`m.name ILIKE ${'%' + escapeSearchString(mapName) + '%'}`)
    }

    if (playerName) {
      whereClauses.push(sql`
        EXISTS (
          SELECT 1 FROM games_users gu2
          INNER JOIN users u ON gu2.user_id = u.id
          WHERE gu2.game_id = g.id
          AND u.name ILIKE ${'%' + escapeSearchString(playerName) + '%'}
        )
      `)
    }

    if (format) {
      const teamSize = getTeamSizeForFormat(format)
      whereClauses.push(sql`
        g.selected_matchup ~ ${`^[prtz]{${teamSize}}-[prtz]{${teamSize}}$`}
      `)
    }

    if (format && matchup) {
      const hasNonUndefinedRace = [...matchup.team1, ...matchup.team2].some(r => r !== undefined)

      if (hasNonUndefinedRace) {
        const matchupStrings = expandMatchupFilter(matchup)
        whereClauses.push(sql`g.assigned_matchup = ANY(${matchupStrings})`)
      }
    }

    // NOTE(2Pac): All of these include `g.id` as a final tiebreaker so the ordering is fully
    // deterministic. Without it, rows that tie on the leading column (e.g. games that share a
    // start_time) can be duplicated or skipped across paginated requests. This is especially
    // relevant here since this list is a moving window (games complete continuously), so pages are
    // loaded at different points in time.
    let orderBy = sqlRaw('g.start_time DESC, g.id DESC')
    if (sort) {
      switch (sort) {
        case GameSortOption.LatestFirst:
          orderBy = sqlRaw('g.start_time DESC, g.id DESC')
          break
        case GameSortOption.OldestFirst:
          orderBy = sqlRaw('g.start_time ASC, g.id ASC')
          break
        case GameSortOption.ShortestFirst:
          orderBy = sqlRaw('g.game_length ASC NULLS LAST, g.start_time DESC, g.id DESC')
          break
        case GameSortOption.LongestFirst:
          orderBy = sqlRaw('g.game_length DESC NULLS LAST, g.start_time DESC, g.id DESC')
          break
        default:
          sort satisfies never
      }
    }

    let query = sql`
      SELECT g.*
      FROM games g
    `

    if (needMapJoin) {
      query = query.append(sql`
        INNER JOIN uploaded_maps m ON g.map_id = m.id
      `)
    }

    query = query.append(sql`
      WHERE ${sqlConcat(' AND ', whereClauses)}
      ORDER BY ${orderBy}
      LIMIT ${limit}
      OFFSET ${offset}
    `)

    const result = await client.query<DbGameRecord>(query)

    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/**
 * Retrieves game information for the match history of a user. Never returns a results-exempt game
 * (contains computer players — see `isResultsExempt`).
 */
export async function getGamesForUser(
  params: {
    userId: SbUserId
    limit: number
    offset: number
    ranked?: boolean
    custom?: boolean
    duration?: GameDurationFilter
    mapName?: string
    playerName?: string
    format?: GameFormat
    matchup?: MatchupFilter
    sort?: GameSortOption
  },
  withClient?: DbClient,
): Promise<GameRecord[]> {
  const {
    userId,
    limit,
    offset,
    ranked,
    custom,
    duration,
    mapName,
    playerName,
    format,
    matchup,
    sort,
  } = params

  const { client, done } = await db(withClient)
  try {
    const whereClauses = [
      sql`gu.user_id = ${userId}`,
      sql`(g.config->>'resultsExempt')::boolean IS NOT TRUE`,
    ]
    let needMapJoin = false

    if (ranked || custom) {
      const sourceConditions = []
      if (ranked) {
        sourceConditions.push(sql`g.config->>'gameSource' = ${GameSource.Matchmaking}`)
      }
      if (custom) {
        sourceConditions.push(sql`g.config->>'gameSource' = ${GameSource.Lobby}`)
      }
      whereClauses.push(sql`(${sqlConcat(' OR ', sourceConditions)})`)
    }

    if (duration && duration !== GameDurationFilter.All) {
      switch (duration) {
        case GameDurationFilter.Under10:
          whereClauses.push(sql`g.game_length < 600000`)
          break
        case GameDurationFilter.From10To20:
          whereClauses.push(sql`g.game_length >= 600000 AND g.game_length < 1200000`)
          break
        case GameDurationFilter.From20To30:
          whereClauses.push(sql`g.game_length >= 1200000 AND g.game_length < 1800000`)
          break
        case GameDurationFilter.Over30:
          whereClauses.push(sql`g.game_length >= 1800000`)
          break
        default:
          duration satisfies never
      }
    }

    if (mapName) {
      needMapJoin = true
      whereClauses.push(sql`m.name ILIKE ${'%' + escapeSearchString(mapName) + '%'}`)
    }

    if (playerName) {
      whereClauses.push(sql`
        EXISTS (
          SELECT 1 FROM games_users gu2
          INNER JOIN users u ON gu2.user_id = u.id
          WHERE gu2.game_id = g.id
          AND u.name ILIKE ${'%' + escapeSearchString(playerName) + '%'}
        )
      `)
    }

    if (format) {
      const teamSize = getTeamSizeForFormat(format)
      // Match games with exactly 2 teams where both teams have the expected size
      whereClauses.push(sql`
        g.selected_matchup ~ ${`^[prtz]{${teamSize}}-[prtz]{${teamSize}}$`}
      `)
    }

    if (format && matchup) {
      const hasNonUndefinedRace = [...matchup.team1, ...matchup.team2].some(r => r !== undefined)

      if (hasNonUndefinedRace) {
        const matchupStrings = expandMatchupFilter(matchup)
        whereClauses.push(sql`g.assigned_matchup = ANY(${matchupStrings})`)
      }
    }

    // NOTE(2Pac): All of these include `g.id` as a final tiebreaker so the ordering is fully
    // deterministic. Without it, rows that tie on the leading column (e.g. many unreconciled games
    // all have a NULL game_length, or games that share a start_time) can be duplicated or skipped
    // across paginated requests.
    let orderBy = sqlRaw('g.start_time DESC, g.id DESC')
    if (sort) {
      switch (sort) {
        case GameSortOption.LatestFirst:
          orderBy = sqlRaw('g.start_time DESC, g.id DESC')
          break
        case GameSortOption.OldestFirst:
          orderBy = sqlRaw('g.start_time ASC, g.id ASC')
          break
        case GameSortOption.ShortestFirst:
          orderBy = sqlRaw('g.game_length ASC NULLS LAST, g.start_time DESC, g.id DESC')
          break
        case GameSortOption.LongestFirst:
          orderBy = sqlRaw('g.game_length DESC NULLS LAST, g.start_time DESC, g.id DESC')
          break
        default:
          sort satisfies never
      }
    }

    let query = sql`
      SELECT g.*
      FROM games_users gu
      INNER JOIN games g ON gu.game_id = g.id
    `

    if (needMapJoin) {
      query = query.append(sql`
        INNER JOIN uploaded_maps m ON g.map_id = m.id
      `)
    }

    query = query.append(sql`
      WHERE ${sqlConcat(' AND ', whereClauses)}
      ORDER BY ${orderBy}
      LIMIT ${limit}
      OFFSET ${offset}
    `)

    const result = await client.query<DbGameRecord>(query)

    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/**
 * Returns a list of game IDs that don't yet have reconciled results. This can be used to (roughly)
 * determine games that have completed but didn't get reconciled (usually because at least one
 * player failed to report).
 *
 * Excludes netcode-v2 games that persisted a coordinator session id — those are covered by the
 * sweep's coordinator liveness probe instead (`findUnreconciledV2GamesForProbe`), so this is
 * effectively the legacy/pre-cutover backstop now. Also excludes results-exempt games (contains
 * computer players — see `isResultsExempt`), which never reconcile; a legacy comp game predating
 * the exemption flag still flows through here as it always has.
 *
 * @param reportedBeforeTime Only include game IDs that have a reported result from before this time
 * @param withClient a DB client to use to make the query (optional)
 */
export async function findUnreconciledGames(
  reportedBeforeTime: Date,
  withClient?: DbClient,
): Promise<string[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ id: string }>(sql`
      SELECT DISTINCT gu.game_id as "id"
      FROM games_users gu
      JOIN games g ON g.id = gu.game_id
      WHERE gu."reported_results" IS NOT NULL
      AND gu."result" IS NULL
      AND gu.reported_at < ${reportedBeforeTime}
      AND g.netcode_v2_session IS NULL
      AND (g.config->>'resultsExempt')::boolean IS NOT TRUE;
    `)
    return result.rows.map(row => row.id)
  } finally {
    done()
  }
}

/**
 * Returns unreconciled netcode-v2 games that persisted a coordinator session id and started before
 * `olderThan`, for the periodic sweep's coordinator liveness probe. A v2 game only reaches this
 * backstop if it missed both push paths (the zero-grace known-complete trigger and `sessionClosed`)
 * -- ~zero in steady state -- so the sweep asks the coordinator directly whether each session is
 * still alive instead of blind-forcing on a timeout. Excludes results-exempt games (contains
 * computer players — see `isResultsExempt`), which never reconcile.
 *
 * @param olderThan Only include games that started before this time
 * @param withClient a DB client to use to make the query (optional)
 */
export async function findUnreconciledV2GamesForProbe(
  olderThan: Date,
  withClient?: DbClient,
): Promise<Array<{ gameId: string; session: number }>> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ id: string; netcode_v2_session: string }>(sql`
      SELECT id, netcode_v2_session
      FROM games
      WHERE results IS NULL
      AND netcode_v2_session IS NOT NULL
      AND start_time < ${olderThan}
      AND (config->>'resultsExempt')::boolean IS NOT TRUE;
    `)
    return result.rows.map(row => ({
      gameId: row.id,
      // netcode_v2_session is a BIGINT, so pg returns it as a string; normalize to a number.
      session: Number(row.netcode_v2_session),
    }))
  } finally {
    done()
  }
}

/**
 * Returns a list of game IDs where every player has reported results but the game still has no
 * reconciled result, and whose most recent report is older than `reportedBeforeTime`. This catches
 * games that were fully reported but never reconciled (e.g. the server restarted during the desync
 * verdict grace window), so they can be reconciled without waiting for the 3h force sweep.
 * Excludes results-exempt games (contains computer players — see `isResultsExempt`), which never
 * reconcile.
 *
 * @param reportedBeforeTime Only include games whose newest report predates this time
 * @param withClient a DB client to use to make the query (optional)
 */
export async function findFullyReportedUnreconciledGames(
  reportedBeforeTime: Date,
  withClient?: DbClient,
): Promise<string[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ id: string }>(sql`
      SELECT gu.game_id AS "id"
      FROM games_users gu
      JOIN games g ON g.id = gu.game_id
      WHERE g.results IS NULL
      AND (g.config->>'resultsExempt')::boolean IS NOT TRUE
      GROUP BY gu.game_id
      HAVING bool_and(gu.reported_results IS NOT NULL)
        AND MAX(gu.reported_at) < ${reportedBeforeTime};
    `)
    return result.rows.map(row => row.id)
  } finally {
    done()
  }
}

/**
 * Returns a list of unreconciled netcode-v2 game IDs where every human has either reported results
 * or had a departure recorded, and the newest such report/departure is older than
 * `olderThan`. A netcode-v2 game's result inputs are closed the moment every human is in one of
 * those two states (a departed human can't report, a reported one can't report again), so these
 * are safe to force-reconcile without waiting for the much longer legacy timeout. Excludes
 * results-exempt games (contains computer players — see `isResultsExempt`), which never reconcile.
 *
 * @param olderThan Only include games whose newest report/departure predates this time
 * @param withClient a DB client to use to make the query (optional)
 */
export async function findKnownCompleteUnreconciledGames(
  olderThan: Date,
  withClient?: DbClient,
): Promise<string[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ id: string }>(sql`
      SELECT gu.game_id AS "id"
      FROM games_users gu
      JOIN games g ON g.id = gu.game_id
      WHERE g.results IS NULL
      AND (g.config->>'useNetcodeV2')::boolean IS TRUE
      AND (g.config->>'resultsExempt')::boolean IS NOT TRUE
      GROUP BY gu.game_id
      HAVING bool_and(gu.reported_results IS NOT NULL OR gu.departure_kind IS NOT NULL)
        AND MAX(GREATEST(gu.reported_at, gu.departure_time)) < ${olderThan};
    `)
    return result.rows.map(row => row.id)
  } finally {
    done()
  }
}
