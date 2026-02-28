import { GameSource } from '../../../common/games/configuration'
import {
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  getTeamSizeForFormat,
  MatchupFilter,
} from '../../../common/games/game-filters'
import { GameRecord, GameRouteDebugInfo } from '../../../common/games/games'
import { expandMatchupFilter, MatchupString } from '../../../common/games/matchups'
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
    results: row.results,
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
 * Updates the route debug info for the specified game. This should be used when the game is in the
 * process of loading, and all players have had their rally-point routes determined and created.
 */
export async function updateRouteDebugInfo(
  gameId: string,
  routeDebugInfo: GameRouteDebugInfo[],
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      UPDATE games
      SET routes = ${routeDebugInfo}
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
 * will also include games that have incomplete results or are disputed.
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
      ORDER BY u.start_time DESC
      LIMIT ${numGames}
    `)
    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/**
 * Retrieves completed matchmaking games for the platform games list.
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

    let orderBy = sqlRaw('g.start_time DESC')
    if (sort) {
      switch (sort) {
        case GameSortOption.LatestFirst:
          orderBy = sqlRaw('g.start_time DESC')
          break
        case GameSortOption.OldestFirst:
          orderBy = sqlRaw('g.start_time ASC')
          break
        case GameSortOption.ShortestFirst:
          orderBy = sqlRaw('g.game_length ASC NULLS LAST')
          break
        case GameSortOption.LongestFirst:
          orderBy = sqlRaw('g.game_length DESC NULLS LAST')
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
 * Retrieves game information for the match history of a user.
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
    const whereClauses = [sql`gu.user_id = ${userId}`]
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

    let orderBy = sqlRaw('g.start_time DESC')
    if (sort) {
      switch (sort) {
        case GameSortOption.LatestFirst:
          orderBy = sqlRaw('g.start_time DESC')
          break
        case GameSortOption.OldestFirst:
          orderBy = sqlRaw('g.start_time ASC')
          break
        case GameSortOption.ShortestFirst:
          orderBy = sqlRaw('g.game_length ASC NULLS LAST')
          break
        case GameSortOption.LongestFirst:
          orderBy = sqlRaw('g.game_length DESC NULLS LAST')
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
      WHERE gu."reported_results" IS NOT NULL
      AND gu."result" IS NULL
      AND gu.reported_at < ${reportedBeforeTime};
    `)
    return result.rows.map(row => row.id)
  } finally {
    done()
  }
}

/**
 * Retrieves route debug information for a specific game, with server descriptions.
 */
export async function getGameRoutes(gameId: string): Promise<GameRouteDebugInfo[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ routes: GameRouteDebugInfo[] | null }>(sql`
      SELECT routes
      FROM games
      WHERE id = ${gameId}
    `)

    if (!result.rowCount || !result.rows[0].routes) {
      return []
    }

    const routes = result.rows[0].routes

    // Get server descriptions for all unique server IDs
    const serverIds = [...new Set(routes.map(r => r.server))]
    if (serverIds.length === 0) {
      return routes
    }

    const serversResult = await client.query<{ id: number; description: string }>(sql`
      SELECT id, description
      FROM rally_point_servers
      WHERE id = ANY(${serverIds})
    `)

    const serverDescriptions = new Map(serversResult.rows.map(row => [row.id, row.description]))

    // Add server descriptions to routes
    return routes.map(route => ({
      ...route,
      serverDescription: serverDescriptions.get(route.server),
    }))
  } finally {
    done()
  }
}
