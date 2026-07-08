import { ReadonlyDeep } from 'type-fest'
import { DepartureKind } from '../../../common/games/netcode-v2'
import {
  GameClientPlayerResult,
  ReconciledPlayerResult,
  ReconciledResult,
  StoredGameResults,
  StoredRawGameResults,
} from '../../../common/games/results'
import { AssignedRaceChar, RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

export interface GameUserReportedResults {
  userId: SbUserId
  reportedAt?: Date
  reportedResults?: StoredGameResults
}

export interface ReportedResultsData {
  userId: SbUserId
  gameId: string
  reportedAt: Date
  /** The stored report: either a legacy digested report or a raw (v2) report. */
  reportedResults: StoredGameResults
}

/**
 * A user's stored report as returned for reconciliation, discriminated between the legacy digested
 * form (already a set of per-player verdicts) and the raw (v2) form (undigested BW evidence the
 * server derives verdicts from). Both carry the `reporter` (the user the row belongs to).
 */
export type StoredResultReport =
  | {
      kind: 'legacy'
      reporter: SbUserId
      time: number
      playerResults: Array<[SbUserId, GameClientPlayerResult]>
    }
  | {
      kind: 'raw'
      reporter: SbUserId
      raw: StoredRawGameResults
    }

export interface GameUserRecord {
  userId: SbUserId
  gameId: string
  startTime: Date
  selectedRace: RaceChar
  resultCode: string
  reportedResults: ReportedResultsData | null
  reportedAt: Date | null
  assignedRace: AssignedRaceChar | null
  result: ReconciledResult | null
  apm: number | null
  replayFileId: string | null
  /** How this user's slot departed mid-game (left/dropped), or null if never recorded. */
  departureKind: DepartureKind | null
  /** When the mid-game departure was recorded, or null if never recorded. */
  departureTime: Date | null
  /**
   * When the netcode-v2 relay recorded this user's result report arriving, or null if the result
   * (if any) wasn't relay-reported. Audit/timeline only — drives no reconciliation policy.
   */
  relayReportTime: Date | null
  /**
   * The relay's local session frame at the moment it recorded the report, or null if unknown or
   * not relay-reported.
   */
  relayReportFrame: number | null
}

type DbGameUser = Dbify<GameUserRecord>

export type CreateGameUserRecordData = Pick<
  GameUserRecord,
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
      assigned_race, result, apm
    ) VALUES (
      ${userId}, ${gameId}, ${startTime}, ${selectedRace}, ${resultCode}, NULL, NULL,
      NULL, NULL, NULL
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
  userId: SbUserId,
  gameId: string,
): Promise<GameUserRecord | null> {
  const { client, done } = await db()

  try {
    const result = await client.query<DbGameUser>(
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
      assignedRace: row.assigned_race,
      result: row.result,
      apm: row.apm,
      replayFileId: row.replay_file_id,
      departureKind: row.departure_kind,
      departureTime: row.departure_time,
      relayReportTime: row.relay_report_time,
      relayReportFrame: row.relay_report_frame,
    }
  } finally {
    done()
  }
}

/**
 * Updates a particular user's results for a game, optionally stamping when/where a netcode-v2
 * relay recorded the report arriving (omitted, or explicitly `undefined`/`null`, for a report that
 * didn't come from the relay, e.g. the direct `results2` endpoint).
 */
export async function setReportedResults({
  userId,
  gameId,
  reportedResults,
  reportedAt,
  relayReportTime,
  relayReportFrame,
}: ReadonlyDeep<ReportedResultsData> & {
  relayReportTime?: Date
  relayReportFrame?: number | null
}) {
  const { client, done } = await db()

  try {
    await client.query(sql`
      UPDATE games_users
      SET
        reported_results = ${reportedResults},
        reported_at = ${reportedAt},
        relay_report_time = ${relayReportTime ?? null},
        relay_report_frame = ${relayReportFrame ?? null}
      WHERE user_id = ${userId} AND game_id = ${gameId}
    `)
  } finally {
    done()
  }
}

/**
 * Gets the current reported results for all the users in a game, as stored (a legacy digested report
 * or a raw v2 report). Callers derive verdicts from raw reports before reconciling.
 */
export async function getCurrentReportedResults(
  gameId: string,
): Promise<Array<StoredResultReport | null>> {
  const { client, done } = await db()

  try {
    const result = await client.query<{
      user_id: SbUserId
      reported_results: StoredGameResults | null
    }>(sql`
      SELECT user_id, reported_results
      FROM games_users
      WHERE game_id = ${gameId}
      ORDER BY reported_at DESC
    `)

    return result.rows.map(row => {
      const stored = row.reported_results
      if (!stored) {
        return null
      }
      if ('version' in stored) {
        return { kind: 'raw', reporter: row.user_id, raw: stored }
      }
      return {
        kind: 'legacy',
        reporter: row.user_id,
        time: stored.time,
        playerResults: stored.playerResults,
      }
    })
  } finally {
    done()
  }
}

/**
 * Returns the most recent `reported_at` time across all users in a game, or null if no user has
 * reported yet.
 */
export async function getMaxReportedAtForGame(gameId: string): Promise<Date | null> {
  const { client, done } = await db()

  try {
    const result = await client.query<{ max_reported_at: Date | null }>(sql`
      SELECT MAX(reported_at) AS max_reported_at
      FROM games_users
      WHERE game_id = ${gameId}
    `)

    return result.rows[0]?.max_reported_at ?? null
  } finally {
    done()
  }
}

/**
 * Returns each user's recorded mid-game departure time for a game (null for users that never had a
 * departure recorded), keyed by user ID.
 */
export async function getDepartureTimesForGame(
  gameId: string,
): Promise<Map<SbUserId, Date | null>> {
  const { client, done } = await db()

  try {
    const result = await client.query<{ user_id: SbUserId; departure_time: Date | null }>(sql`
      SELECT user_id, departure_time
      FROM games_users
      WHERE game_id = ${gameId}
    `)

    return new Map(result.rows.map(row => [row.user_id, row.departure_time]))
  } finally {
    done()
  }
}

/**
 * Sets the reconciled (and probably final) result for a particular user in a game. This is intended
 * to be executed in a transaction that updates all the users and the full game results at once.
 */
export async function setUserReconciledResult(
  client: DbClient,
  userId: SbUserId,
  gameId: string,
  result: ReconciledPlayerResult,
) {
  return client.query(sql`
    UPDATE games_users
    SET
      assigned_race = ${result.race},
      result = ${result.result},
      apm = ${result.apm}
    WHERE user_id = ${userId} AND game_id = ${gameId}
  `)
}

/**
 * Records a mid-game departure (left/dropped) for a user's game record, regardless of whether that
 * record already holds results — the departure is relay-side evidence of what happened on the
 * network, recorded unconditionally so it survives adversarial cases like a player pre-submitting
 * fake results before cutting their own connection. Whether a recorded departure was actually a
 * benign post-result exit (e.g. lingering on the victory dialog) is derivable later by comparing
 * `departure_time` against `reported_at`, rather than by refusing to record it here.
 *
 * The `WHERE` clause's only remaining job is dedup: a game+user that already has a recorded
 * departure yields no update, so a duplicate/retried webhook (delivery is at-least-once) is a no-op
 * and the first departure recorded for a user in a game always wins.
 *
 * @returns whether a row was actually updated (false means this was a duplicate).
 */
export async function recordUserDeparture({
  userId,
  gameId,
  kind,
  time,
}: {
  userId: SbUserId
  gameId: string
  kind: DepartureKind
  time: Date
}): Promise<boolean> {
  const { client, done } = await db()

  try {
    const result = await client.query(sql`
      UPDATE games_users
      SET
        departure_kind = ${kind},
        departure_time = ${time}
      WHERE user_id = ${userId} AND game_id = ${gameId} AND departure_kind IS NULL
    `)

    return !!result.rowCount
  } finally {
    done()
  }
}

/**
 * Whether every human player in a game has either reported results or had a departure recorded —
 * the two states a relay-tracked (netcode-v2) human can end up in once their link to the game is
 * closed, since a departed player can no longer report and a reported one can't report again. A
 * game with no `games_users` rows at all (e.g. an unknown game id) is never considered accounted
 * for.
 */
export async function areAllHumansAccountedFor(gameId: string): Promise<boolean> {
  const { client, done } = await db()

  try {
    const result = await client.query<{ all_accounted: boolean | null; total: string }>(sql`
      SELECT
        bool_and(reported_results IS NOT NULL OR departure_kind IS NOT NULL) AS all_accounted,
        count(*) AS total
      FROM games_users
      WHERE game_id = ${gameId}
    `)

    const row = result.rows[0]
    return Number(row?.total ?? 0) > 0 && row?.all_accounted === true
  } finally {
    done()
  }
}

/**
 * Links a replay file to a user's game record.
 */
export async function setReplayFileId(
  userId: SbUserId,
  gameId: string,
  replayFileId: string,
): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      UPDATE games_users
      SET replay_file_id = ${replayFileId}
      WHERE user_id = ${userId} AND game_id = ${gameId}
    `)
  } finally {
    done()
  }
}

/**
 * Gets reported results for all users in a game (for debug purposes).
 */
export async function getGameReportedResults(gameId: string): Promise<GameUserReportedResults[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<{
      user_id: SbUserId
      reported_at?: Date | null
      reported_results?: StoredGameResults | null
    }>(sql`
      SELECT user_id, reported_at, reported_results
      FROM games_users
      WHERE game_id = ${gameId}
      ORDER BY user_id
    `)
    return result.rows.map(row => ({
      userId: row.user_id,
      reportedAt: row.reported_at ?? undefined,
      reportedResults: row.reported_results ?? undefined,
    }))
  } finally {
    done()
  }
}
