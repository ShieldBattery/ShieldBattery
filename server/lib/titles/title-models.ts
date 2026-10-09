import { GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import {
  getTotalBonusPool,
  isSoloType,
  MatchmakingDivision,
  MatchmakingSeason,
  MatchmakingType,
  pointsToMatchmakingDivision,
} from '../../../common/matchmaking'
import {
  isTitleId,
  makeEmptyTitleMetrics,
  TitleDivision,
  TitleId,
  TitleMetrics,
  TitleMode,
} from '../../../common/titles'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { sql } from '../db/sql'

/** Ranked wins in games shorter than this count toward the quick-win feat. */
const QUICK_WIN_MAX_MS = 4 * 60 * 1000
/** Ranked wins in games longer than this count toward the long-win feat. */
const LONG_WIN_MIN_MS = 60 * 60 * 1000
/** How many of the most recent ranked games the APM feat averages over. */
const RECENT_APM_GAMES = 50

const SOLO_MATCHMAKING_TYPES: ReadonlyArray<MatchmakingType> = [
  MatchmakingType.Match1v1,
  MatchmakingType.Match1v1Fastest,
]
const MIRROR_MATCHUPS = ['p-p', 't-t', 'z-z']

const DIVISION_TO_TITLE_DIVISION: Readonly<Record<MatchmakingDivision, TitleDivision | undefined>> =
  {
    [MatchmakingDivision.Unrated]: undefined,
    [MatchmakingDivision.Bronze1]: TitleDivision.Bronze,
    [MatchmakingDivision.Bronze2]: TitleDivision.Bronze,
    [MatchmakingDivision.Bronze3]: TitleDivision.Bronze,
    [MatchmakingDivision.Silver1]: TitleDivision.Silver,
    [MatchmakingDivision.Silver2]: TitleDivision.Silver,
    [MatchmakingDivision.Silver3]: TitleDivision.Silver,
    [MatchmakingDivision.Gold1]: TitleDivision.Gold,
    [MatchmakingDivision.Gold2]: TitleDivision.Gold,
    [MatchmakingDivision.Gold3]: TitleDivision.Gold,
    [MatchmakingDivision.Platinum1]: TitleDivision.Platinum,
    [MatchmakingDivision.Platinum2]: TitleDivision.Platinum,
    [MatchmakingDivision.Platinum3]: TitleDivision.Platinum,
    [MatchmakingDivision.Diamond1]: TitleDivision.Diamond,
    [MatchmakingDivision.Diamond2]: TitleDivision.Diamond,
    [MatchmakingDivision.Diamond3]: TitleDivision.Diamond,
    [MatchmakingDivision.Champion]: TitleDivision.Champion,
  }

/** A ranked game's points outcome for a user. */
export interface RatingChangePoints {
  matchmakingType: MatchmakingType
  /** The user's points after the game. */
  points: number
  changeDate: Date
}

/**
 * Returns the highest division `changes` reached, using each change's season bonus pool at the time
 * of the change (division bounds grow with the bonus pool, so the same points can be a lower
 * division later in a season).
 *
 * @param seasons every matchmaking season, newest first (as `MatchmakingSeasonsService` returns them)
 */
export function getPeakDivision(
  changes: ReadonlyArray<RatingChangePoints>,
  seasons: ReadonlyArray<MatchmakingSeason>,
): TitleDivision | undefined {
  let peak: TitleDivision | undefined
  for (const change of changes) {
    const changeTime = Number(change.changeDate)
    const seasonIndex = seasons.findIndex(s => Number(s.startDate) <= changeTime)
    const season = seasons[seasonIndex === -1 ? seasons.length - 1 : seasonIndex]
    if (!season) {
      continue
    }
    const seasonEnd = seasonIndex > 0 ? seasons[seasonIndex - 1].startDate : undefined
    const bonusPool = getTotalBonusPool(change.changeDate, season.startDate, seasonEnd)
    const division =
      DIVISION_TO_TITLE_DIVISION[
        pointsToMatchmakingDivision(isSoloType(change.matchmakingType), change.points, bonusPool)
      ]
    if (division !== undefined && (peak === undefined || division > peak)) {
      peak = division
    }
  }
  return peak
}

/**
 * Computes the play statistics that earned titles are checked against for a user, from the data
 * the server already keeps about their games.
 */
export async function getTitleMetrics(
  client: DbClient,
  userId: SbUserId,
  seasons: ReadonlyArray<MatchmakingSeason>,
): Promise<TitleMetrics> {
  const metrics = makeEmptyTitleMetrics()

  const statsResult = await client.query<{
    p_wins: number
    t_wins: number
    z_wins: number
    r_wins: number
    games: number
  }>(sql`
    SELECT p_wins, t_wins, z_wins, r_wins,
      p_wins + p_losses + t_wins + t_losses + z_wins + z_losses + r_wins + r_losses AS games
    FROM user_stats
    WHERE user_id = ${userId}
  `)
  if (statsResult.rows.length) {
    const stats = statsResult.rows[0]
    metrics.raceWins = { p: stats.p_wins, t: stats.t_wins, z: stats.z_wins, r: stats.r_wins }
    metrics.gamesPlayed = stats.games
  }

  const ratingsResult = await client.query<{
    one_v_one: string | null
    two_v_two: string | null
    bgh: string | null
    seasons: string
  }>(sql`
    SELECT
      SUM(wins) FILTER (WHERE matchmaking_type = ${MatchmakingType.Match1v1}) AS one_v_one,
      SUM(wins) FILTER (WHERE matchmaking_type = ${MatchmakingType.Match2v2}) AS two_v_two,
      SUM(wins) FILTER (
        WHERE matchmaking_type IN (${MatchmakingType.Match2v2Bgh}, ${MatchmakingType.Match3v3Bgh})
      ) AS bgh,
      COUNT(DISTINCT season_id) FILTER (WHERE num_games_played > 0) AS seasons
    FROM matchmaking_ratings
    WHERE user_id = ${userId}
  `)
  const ratings = ratingsResult.rows[0]
  metrics.modeWins = {
    [TitleMode.OneVOne]: Number(ratings?.one_v_one ?? 0),
    [TitleMode.TwoVTwo]: Number(ratings?.two_v_two ?? 0),
    [TitleMode.Bgh]: Number(ratings?.bgh ?? 0),
  }
  metrics.rankedSeasons = Number(ratings?.seasons ?? 0)

  const leagueResult = await client.query<{ wins: string | null }>(sql`
    SELECT SUM(wins) AS wins FROM league_users WHERE user_id = ${userId}
  `)
  metrics.leagueWins = Number(leagueResult.rows[0]?.wins ?? 0)

  const gamesResult = await client.query<{
    played: string
    total_ms: string | null
    ffa_wins: string
    ums_games: string
    quick_wins: string
    long_wins: string
    mirror_wins: string
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE gu.result IN ('win', 'loss', 'draw')) AS played,
      SUM(g.game_length) AS total_ms,
      COUNT(*) FILTER (
        WHERE gu.result = 'win' AND g.config->>'gameType' = ${GameType.FreeForAll}
      ) AS ffa_wins,
      COUNT(*) FILTER (
        WHERE gu.result IN ('win', 'loss', 'draw')
          AND g.config->>'gameType' = ${GameType.UseMapSettings}
      ) AS ums_games,
      COUNT(*) FILTER (
        WHERE gu.result = 'win' AND g.config->>'gameSource' = ${GameSource.Matchmaking}
          AND g.game_length < ${QUICK_WIN_MAX_MS}
      ) AS quick_wins,
      COUNT(*) FILTER (
        WHERE gu.result = 'win' AND g.config->>'gameSource' = ${GameSource.Matchmaking}
          AND g.game_length > ${LONG_WIN_MIN_MS}
      ) AS long_wins,
      COUNT(*) FILTER (
        WHERE gu.result = 'win' AND g.config->>'gameSource' = ${GameSource.Matchmaking}
          AND g.config->'gameSourceExtra'->>'type' = ANY (${SOLO_MATCHMAKING_TYPES})
          AND g.assigned_matchup = ANY (${MIRROR_MATCHUPS})
      ) AS mirror_wins
    FROM games_users gu
    JOIN games g ON g.id = gu.game_id
    WHERE gu.user_id = ${userId}
  `)
  const games = gamesResult.rows[0]
  metrics.hasPlayed = Number(games?.played ?? 0) > 0
  metrics.hoursPlayed = Number(games?.total_ms ?? 0) / (60 * 60 * 1000)
  metrics.ffaWins = Number(games?.ffa_wins ?? 0)
  metrics.umsGames = Number(games?.ums_games ?? 0)
  metrics.quickWins = Number(games?.quick_wins ?? 0)
  metrics.longWins = Number(games?.long_wins ?? 0)
  metrics.mirrorWins = Number(games?.mirror_wins ?? 0)

  const apmResult = await client.query<{ average: string | null; games: string }>(sql`
    SELECT AVG(apm) AS average, COUNT(*) AS games
    FROM (
      SELECT gu.apm
      FROM games_users gu
      JOIN games g ON g.id = gu.game_id
      WHERE gu.user_id = ${userId} AND gu.apm IS NOT NULL
        AND g.config->>'gameSource' = ${GameSource.Matchmaking}
      ORDER BY gu.start_time DESC
      LIMIT ${RECENT_APM_GAMES}
    ) recent
  `)
  metrics.recentApm = {
    average: Number(apmResult.rows[0]?.average ?? 0),
    games: Number(apmResult.rows[0]?.games ?? 0),
  }

  const changesResult = await client.query<{
    matchmaking_type: MatchmakingType
    points: number
    change_date: Date
  }>(sql`
    SELECT matchmaking_type, points, change_date
    FROM matchmaking_rating_changes
    WHERE user_id = ${userId}
  `)
  metrics.peakDivision = getPeakDivision(
    changesResult.rows.map(r => ({
      matchmakingType: r.matchmaking_type,
      points: r.points,
      changeDate: r.change_date,
    })),
    seasons,
  )

  return metrics
}

/** Returns the IDs of the players who have a result row for a game. */
export async function getGamePlayerIds(client: DbClient, gameId: string): Promise<SbUserId[]> {
  const result = await client.query<{ user_id: SbUserId }>(sql`
    SELECT user_id FROM games_users WHERE game_id = ${gameId}
  `)
  return result.rows.map(r => r.user_id)
}

export interface UserTitle {
  id: TitleId
  unlockedAt: Date
  source: 'earned' | 'granted'
  equipped: boolean
}

/** Returns every title a user holds, oldest first. Titles no longer in the catalog are skipped. */
export async function getUserTitles(client: DbClient, userId: SbUserId): Promise<UserTitle[]> {
  const result = await client.query<{
    title_id: string
    unlocked_at: Date
    source: 'earned' | 'granted'
    equipped: boolean
  }>(sql`
    SELECT title_id, unlocked_at, source, equipped
    FROM user_titles
    WHERE user_id = ${userId}
    ORDER BY unlocked_at, title_id
  `)
  return result.rows.flatMap(r =>
    isTitleId(r.title_id)
      ? [{ id: r.title_id, unlockedAt: r.unlocked_at, source: r.source, equipped: r.equipped }]
      : [],
  )
}

/**
 * Records earned titles for a user, skipping any they already hold.
 *
 * @returns the IDs that were newly recorded
 */
export async function insertEarnedTitles(
  client: DbClient,
  userId: SbUserId,
  titleIds: ReadonlyArray<TitleId>,
): Promise<TitleId[]> {
  if (!titleIds.length) {
    return []
  }
  const result = await client.query<{ title_id: TitleId }>(sql`
    INSERT INTO user_titles (user_id, title_id, source)
    SELECT ${userId}, unnest(${titleIds}::text[]), 'earned'
    ON CONFLICT (user_id, title_id) DO NOTHING
    RETURNING title_id
  `)
  return result.rows.map(r => r.title_id)
}

/**
 * Grants a title to a user.
 *
 * @returns whether the title was newly granted (`false` if the user already held it)
 */
export async function grantTitle(
  client: DbClient,
  userId: SbUserId,
  titleId: TitleId,
  grantedBy: SbUserId,
): Promise<boolean> {
  const result = await client.query(sql`
    INSERT INTO user_titles (user_id, title_id, source, granted_by)
    VALUES (${userId}, ${titleId}, 'granted', ${grantedBy})
    ON CONFLICT (user_id, title_id) DO NOTHING
  `)
  return (result.rowCount ?? 0) > 0
}

/**
 * Removes a title from a user.
 *
 * @returns whether the user held the title, and whether it was the one they had equipped
 */
export async function revokeTitle(
  client: DbClient,
  userId: SbUserId,
  titleId: TitleId,
): Promise<{ removed: boolean; wasEquipped: boolean }> {
  const result = await client.query<{ equipped: boolean }>(sql`
    DELETE FROM user_titles
    WHERE user_id = ${userId} AND title_id = ${titleId}
    RETURNING equipped
  `)
  return { removed: result.rows.length > 0, wasEquipped: !!result.rows[0]?.equipped }
}

/**
 * Sets the title a user displays. `undefined` equips the default title. Must be called within a
 * transaction, since it clears the previous title before setting the new one (the equipped index
 * is checked row by row, so the two can't be swapped in a single statement).
 *
 * @returns whether the title could be equipped (`false`, with nothing changed, if the user doesn't
 *   hold it)
 */
export async function setEquippedTitle(
  client: DbClient,
  userId: SbUserId,
  titleId: TitleId | undefined,
): Promise<boolean> {
  if (titleId !== undefined) {
    // Locks the row so the title can't be revoked between this check and equipping it
    const held = await client.query(sql`
      SELECT 1
      FROM user_titles
      WHERE user_id = ${userId} AND title_id = ${titleId}
      FOR UPDATE
    `)
    if (!held.rowCount) {
      return false
    }
  }

  await client.query(sql`
    UPDATE user_titles
    SET equipped = false
    WHERE user_id = ${userId} AND equipped
  `)
  if (titleId !== undefined) {
    await client.query(sql`
      UPDATE user_titles
      SET equipped = true
      WHERE user_id = ${userId} AND title_id = ${titleId}
    `)
  }
  return true
}
