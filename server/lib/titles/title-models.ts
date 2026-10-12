import { GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { MatchupString } from '../../../common/games/matchups'
import { ReconciledResult } from '../../../common/games/results'
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
import { sql, sqlConcat } from '../db/sql'

/** Ranked wins in games shorter than this count toward the quick-win feat. */
const QUICK_WIN_MAX_MS = 4 * 60 * 1000
/** Ranked wins in games longer than this count toward the long-win feat. */
const LONG_WIN_MIN_MS = 60 * 60 * 1000
/** Game results that count as having played a game. */
const PLAYED_RESULTS: ReadonlyArray<ReconciledResult> = ['win', 'loss', 'draw']

const SOLO_MATCHMAKING_TYPES: ReadonlyArray<MatchmakingType> = [
  MatchmakingType.Match1v1,
  MatchmakingType.Match1v1Fastest,
]
const MIRROR_MATCHUPS: ReadonlyArray<string> = ['p-p', 't-t', 'z-z']

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

/** Returns the points outcomes of a user's ranked games, optionally limited to a single game. */
export async function getRatingChangePoints(
  client: DbClient,
  userId: SbUserId,
  gameId?: string,
): Promise<RatingChangePoints[]> {
  const result = await client.query<{
    matchmaking_type: MatchmakingType
    points: number
    change_date: Date
  }>(sql`
    SELECT matchmaking_type, points, change_date
    FROM matchmaking_rating_changes
    WHERE user_id = ${userId} AND (${gameId ?? null}::uuid IS NULL OR game_id = ${gameId ?? null})
  `)
  return result.rows.map(r => ({
    matchmakingType: r.matchmaking_type,
    points: r.points,
    changeDate: r.change_date,
  }))
}

/**
 * The counts kept in `user_title_tracking.counters`, by name. A counter that hasn't been counted yet
 * is absent, and counts as 0.
 */
export interface TitleCounters {
  /** Games of any kind with a win, loss, or draw. */
  games: number
  /** Total length of those games. */
  msPlayed: number
  ffaWins: number
  /** Use map settings games with a win, loss, or draw. */
  umsGames: number
  rankedQuickWins: number
  rankedLongWins: number
  /** Ranked 1v1 wins against the same race. */
  rankedMirrorWins: number
  /** Total APM across ranked games that were actually played, for averaging. */
  rankedApmTotal: number
  /** Ranked games counted in `rankedApmTotal`. */
  rankedApmGames: number
}

export type TitleCounter = keyof TitleCounters

/** The parts of a game that determine what it adds to its players' title counters. */
export interface TitleTrackingGame {
  gameType: GameType
  /** The game's matchmaking type, for ranked games. */
  matchmakingType?: MatchmakingType
  lengthMs: number
  /** The races every player was assigned, if they're all known. */
  assignedMatchup?: MatchupString
}

/**
 * Returns what a game adds to a player's title counters (leaving out counters it doesn't add to),
 * or `undefined` if the player's result means the game doesn't count as played.
 */
export function getGameTitleCounters(
  game: TitleTrackingGame,
  player: { result: ReconciledResult; apm: number },
): Partial<TitleCounters> | undefined {
  if (!PLAYED_RESULTS.includes(player.result)) {
    return undefined
  }

  const { matchmakingType } = game
  const counters: Partial<TitleCounters> = { games: 1 }
  if (game.lengthMs > 0) {
    counters.msPlayed = game.lengthMs
  }
  if (game.gameType === GameType.UseMapSettings) {
    counters.umsGames = 1
  }
  if (player.result === 'win' && game.gameType === GameType.FreeForAll) {
    counters.ffaWins = 1
  }

  if (matchmakingType !== undefined) {
    // A game that never got going (e.g. one ended by a lobby violation) has no meaningful APM
    if (game.lengthMs > 0) {
      counters.rankedApmTotal = Math.round(player.apm)
      counters.rankedApmGames = 1
    }
    if (player.result === 'win') {
      if (game.lengthMs < QUICK_WIN_MAX_MS) {
        counters.rankedQuickWins = 1
      } else if (game.lengthMs > LONG_WIN_MIN_MS) {
        counters.rankedLongWins = 1
      }
      if (
        SOLO_MATCHMAKING_TYPES.includes(matchmakingType) &&
        game.assignedMatchup !== undefined &&
        MIRROR_MATCHUPS.includes(game.assignedMatchup)
      ) {
        counters.rankedMirrorWins = 1
      }
    }
  }

  return counters
}

/**
 * Adds to players' title counters. Must be called in the same transaction that applies the results
 * being counted, so each game is counted exactly once.
 */
export async function addTitleCounters(
  client: DbClient,
  entries: ReadonlyArray<{ userId: SbUserId; counters: Partial<TitleCounters> }>,
): Promise<void> {
  if (!entries.length) {
    return
  }

  // Sorted so concurrent games with players in common lock their rows in the same order
  const values = entries
    .toSorted((a, b) => a.userId - b.userId)
    .map(({ userId, counters }) => sql`(${userId}, ${JSON.stringify(counters)}::jsonb)`)
  await client.query(sql`
    INSERT INTO user_title_tracking AS t (user_id, counters)
    VALUES ${sqlConcat(', ', values)}
    ON CONFLICT (user_id) DO UPDATE
    SET counters = jsonb_add_counters(t.counters, EXCLUDED.counters)
  `)
}

/**
 * Replaces a user's game counters with ones counted from their whole game history, and returns the
 * highest division they've reached. This reads every game the user has played, so it's only done
 * once per user, on their first title evaluation: after that, `addTitleCounters` keeps the counters
 * current as each game's results are applied.
 *
 * Must be called within a transaction. The user's counters stay locked until it ends, so the
 * results of a game being applied concurrently are either already committed (and counted in the
 * history read here) or wait to be added on top of these counts.
 *
 * @param seasons every matchmaking season, newest first (as `MatchmakingSeasonsService` returns them)
 */
export async function rebuildTitleCounters(
  client: DbClient,
  userId: SbUserId,
  seasons: ReadonlyArray<MatchmakingSeason>,
): Promise<TitleDivision | undefined> {
  await client.query(sql`
    INSERT INTO user_title_tracking (user_id) VALUES (${userId}) ON CONFLICT DO NOTHING
  `)
  await client.query(sql`
    SELECT 1 FROM user_title_tracking WHERE user_id = ${userId} FOR UPDATE
  `)

  // Counts the same games, the same way, as `getGameTitleCounters` does as results are applied. A
  // disputed game's results aren't applied until it has been resolved, which clears `disputable`.
  await client.query(sql`
    WITH played AS (
      SELECT gu.result, gu.apm, g.game_length, g.assigned_matchup,
        g.config->>'gameType' AS game_type,
        CASE
          WHEN g.config->>'gameSource' = ${GameSource.Matchmaking}
          THEN g.config->'gameSourceExtra'->>'type'
        END AS matchmaking_type
      FROM games_users gu
      JOIN games g ON g.id = gu.game_id
      WHERE gu.user_id = ${userId}
        AND gu.result = ANY (${PLAYED_RESULTS})
        AND NOT g.disputable
    )
    UPDATE user_title_tracking t
    SET counters = t.counters || jsonb_build_object(
      'games', h.games,
      'msPlayed', h.ms_played,
      'ffaWins', h.ffa_wins,
      'umsGames', h.ums_games,
      'rankedQuickWins', h.ranked_quick_wins,
      'rankedLongWins', h.ranked_long_wins,
      'rankedMirrorWins', h.ranked_mirror_wins,
      'rankedApmTotal', h.ranked_apm_total,
      'rankedApmGames', h.ranked_apm_games
    )
    FROM (
      SELECT
        COUNT(*) AS games,
        COALESCE(SUM(game_length) FILTER (WHERE game_length > 0), 0) AS ms_played,
        COUNT(*) FILTER (WHERE result = 'win' AND game_type = ${GameType.FreeForAll}) AS ffa_wins,
        COUNT(*) FILTER (WHERE game_type = ${GameType.UseMapSettings}) AS ums_games,
        COUNT(*) FILTER (
          WHERE result = 'win' AND matchmaking_type IS NOT NULL
            AND game_length < ${QUICK_WIN_MAX_MS}
        ) AS ranked_quick_wins,
        COUNT(*) FILTER (
          WHERE result = 'win' AND matchmaking_type IS NOT NULL
            AND game_length > ${LONG_WIN_MIN_MS}
        ) AS ranked_long_wins,
        COUNT(*) FILTER (
          WHERE result = 'win' AND matchmaking_type = ANY (${SOLO_MATCHMAKING_TYPES})
            AND assigned_matchup = ANY (${MIRROR_MATCHUPS})
        ) AS ranked_mirror_wins,
        COALESCE(
          SUM(ROUND(apm)) FILTER (WHERE matchmaking_type IS NOT NULL AND game_length > 0),
          0
        ) AS ranked_apm_total,
        COUNT(apm) FILTER (
          WHERE matchmaking_type IS NOT NULL AND game_length > 0
        ) AS ranked_apm_games
      FROM played
    ) h
    WHERE t.user_id = ${userId}
  `)

  return getPeakDivision(await getRatingChangePoints(client, userId), seasons)
}

/**
 * Returns the play statistics that earned titles are checked against for a user. Every value comes
 * from a running count or a handful of per-season and per-league rows, so this never reads through
 * the user's games.
 *
 * The user's peak division isn't counted anywhere (the division titles they hold record it), so it's
 * left for the caller to fill in.
 */
export async function getTitleMetrics(client: DbClient, userId: SbUserId): Promise<TitleMetrics> {
  const result = await client.query<{
    p_wins: number | null
    t_wins: number | null
    z_wins: number | null
    r_wins: number | null
    games_played: number | null
    one_v_one: string | null
    two_v_two: string | null
    bgh: string | null
    ranked_seasons: string
    league_wins: string | null
    counters: Partial<TitleCounters> | null
  }>(sql`
    SELECT
      s.p_wins, s.t_wins, s.z_wins, s.r_wins,
      s.p_wins + s.p_losses + s.t_wins + s.t_losses + s.z_wins + s.z_losses + s.r_wins + s.r_losses
        AS games_played,
      r.one_v_one, r.two_v_two, r.bgh, r.ranked_seasons,
      l.league_wins,
      t.counters
    FROM (SELECT ${userId}::integer AS id) u
    LEFT JOIN user_stats s ON s.user_id = u.id
    LEFT JOIN user_title_tracking t ON t.user_id = u.id
    CROSS JOIN LATERAL (
      SELECT
        SUM(wins) FILTER (WHERE matchmaking_type = ${MatchmakingType.Match1v1}) AS one_v_one,
        SUM(wins) FILTER (WHERE matchmaking_type = ${MatchmakingType.Match2v2}) AS two_v_two,
        SUM(wins) FILTER (
          WHERE matchmaking_type IN (${MatchmakingType.Match2v2Bgh}, ${MatchmakingType.Match3v3Bgh})
        ) AS bgh,
        COUNT(DISTINCT season_id) FILTER (WHERE num_games_played > 0) AS ranked_seasons
      FROM matchmaking_ratings
      WHERE user_id = u.id
    ) r
    CROSS JOIN LATERAL (
      SELECT SUM(wins) AS league_wins FROM league_users WHERE user_id = u.id
    ) l
  `)
  const row = result.rows[0]
  const counters = row.counters ?? {}
  const count = (counter: TitleCounter) => Number(counters[counter] ?? 0)
  const apmGames = count('rankedApmGames')

  return {
    ...makeEmptyTitleMetrics(),
    raceWins: { p: row.p_wins ?? 0, t: row.t_wins ?? 0, z: row.z_wins ?? 0, r: row.r_wins ?? 0 },
    gamesPlayed: row.games_played ?? 0,
    hasPlayed: count('games') > 0,
    hoursPlayed: count('msPlayed') / (60 * 60 * 1000),
    modeWins: {
      [TitleMode.OneVOne]: Number(row.one_v_one ?? 0),
      [TitleMode.TwoVTwo]: Number(row.two_v_two ?? 0),
      [TitleMode.Bgh]: Number(row.bgh ?? 0),
    },
    leagueWins: Number(row.league_wins ?? 0),
    ffaWins: count('ffaWins'),
    umsGames: count('umsGames'),
    rankedSeasons: Number(row.ranked_seasons),
    quickWins: count('rankedQuickWins'),
    longWins: count('rankedLongWins'),
    mirrorWins: count('rankedMirrorWins'),
    rankedApm: {
      average: apmGames > 0 ? count('rankedApmTotal') / apmGames : 0,
      games: apmGames,
    },
  }
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
    equipped: boolean | null
  }>(sql`
    SELECT ut.title_id, ut.unlocked_at, ut.source, ut.title_id = u.title AS equipped
    FROM user_titles ut
    JOIN users u ON u.id = ut.user_id
    WHERE ut.user_id = ${userId}
    ORDER BY ut.unlocked_at, ut.title_id
  `)
  return result.rows.flatMap(r =>
    isTitleId(r.title_id)
      ? [{ id: r.title_id, unlockedAt: r.unlocked_at, source: r.source, equipped: !!r.equipped }]
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
