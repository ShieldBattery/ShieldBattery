import { ModerationAction, ModerationActionKind } from '../../../common/moderation-actions'
import { RestrictionKind, RestrictionReason } from '../../../common/users/restrictions'
import { SbUserId } from '../../../common/users/sb-user-id'
import { BanSource } from '../../../common/users/user-network'
import { DbClient, withDbClient } from '../db'
import { sql, SqlTemplate } from '../db/sql'

/**
 * A position in the feed, which is ordered newest first by time, then by kind, then by a per-kind
 * key. Times are kept at microsecond precision so actions sharing a millisecond aren't skipped.
 */
interface FeedPosition {
  timeUs: bigint
  kind: ModerationActionKind
  /** A UUID for most kinds, the user ID for matchmaking bans. */
  key: string | number
}

interface FeedEntry {
  position: FeedPosition
  action: ModerationAction
}

export class InvalidModerationCursorError extends Error {}

export function encodeModerationCursor({ timeUs, kind, key }: FeedPosition): string {
  return `${timeUs}|${kind}|${key}`
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function decodeModerationCursor(cursor: string): FeedPosition {
  const [timeStr, kind, keyStr, ...rest] = cursor.split('|')
  if (
    rest.length ||
    !/^\d{1,19}$/.test(timeStr ?? '') ||
    !Object.values(ModerationActionKind).includes(kind as ModerationActionKind)
  ) {
    throw new InvalidModerationCursorError('invalid cursor')
  }

  if (kind === ModerationActionKind.MatchmakingBan) {
    if (!/^\d{1,10}$/.test(keyStr ?? '')) throw new InvalidModerationCursorError('invalid cursor')
    return { timeUs: BigInt(timeStr), kind, key: Number(keyStr) }
  } else {
    if (!UUID_REGEX.test(keyStr ?? '')) throw new InvalidModerationCursorError('invalid cursor')
    return { timeUs: BigInt(timeStr), kind: kind as ModerationActionKind, key: keyStr }
  }
}

/** Orders positions newest first, matching the per-kind `ORDER BY` clauses below. */
function comparePositions(a: FeedPosition, b: FeedPosition): number {
  if (a.timeUs !== b.timeUs) return a.timeUs > b.timeUs ? -1 : 1
  if (a.kind !== b.kind) return a.kind > b.kind ? -1 : 1
  if (a.key !== b.key) return a.key > b.key ? -1 : 1
  return 0
}

/**
 * Builds the condition selecting rows of `kind` that come after `cursor`, where `time` is a
 * TIMESTAMPTZ expression and `key` is the per-kind key expression (cast to `keyType`).
 */
function afterCursor(
  kind: ModerationActionKind,
  time: SqlTemplate,
  key: SqlTemplate,
  keyType: 'uuid' | 'int4',
  cursor: FeedPosition | undefined,
): SqlTemplate {
  if (!cursor) return sql`TRUE`

  const cursorTime = sql`(TIMESTAMPTZ 'epoch' + ${String(cursor.timeUs)}::int8 * INTERVAL '1 microsecond')`
  if (kind === cursor.kind) {
    const cursorKey =
      keyType === 'uuid' ? sql`${String(cursor.key)}::uuid` : sql`${cursor.key}::int4`
    return sql`(${time}, ${key}) < (${cursorTime}, ${cursorKey})`
  } else if (kind < cursor.kind) {
    return sql`${time} <= ${cursorTime}`
  } else {
    return sql`${time} < ${cursorTime}`
  }
}

function microseconds(time: SqlTemplate): SqlTemplate {
  return sql`(EXTRACT(EPOCH FROM ${time}) * 1000000)::int8`
}

function usToMs(timeUs: bigint): number {
  return Number(timeUs / 1000n)
}

// `user_bans` stores UTC times without a time zone
const BAN_START = sql`(b.start_time AT TIME ZONE 'UTC')`
const BAN_END = sql`(b.end_time AT TIME ZONE 'UTC')`

async function queryBans(
  client: DbClient,
  cursor: FeedPosition | undefined,
  banSource: BanSource | undefined,
  limit: number,
): Promise<FeedEntry[]> {
  const kind = ModerationActionKind.Ban
  const result = await client.query<{
    id: string
    user_id: SbUserId
    time_us: string
    end_time: Date
    banned_by: SbUserId | null
    reason: string | null
    source: BanSource
    cascaded_from: SbUserId | null
    game_id: string | null
    unbanned_at: Date | null
  }>(sql`
    SELECT b.id, b.user_id, ${microseconds(BAN_START)} AS time_us, ${BAN_END} AS end_time,
      b.banned_by, b.reason, b.source, b.cascaded_from, b.game_id, b.unbanned_at
    FROM user_bans b
    WHERE ${afterCursor(kind, BAN_START, sql`b.id`, 'uuid', cursor)}
      AND (${banSource ?? null}::text IS NULL OR b.source = ${banSource ?? null})
    ORDER BY b.start_time DESC, b.id DESC
    LIMIT ${limit}
  `)

  return result.rows.map(row => {
    const timeUs = BigInt(row.time_us)
    return {
      position: { timeUs, kind, key: row.id },
      action: {
        kind,
        id: row.id,
        time: usToMs(timeUs),
        userId: row.user_id,
        endTime: Number(row.end_time),
        bannedBy: row.banned_by ?? undefined,
        reason: row.reason ?? undefined,
        source: row.source,
        cascadedFrom: row.cascaded_from ?? undefined,
        gameId: row.game_id ?? undefined,
        unbannedAt: row.unbanned_at ? Number(row.unbanned_at) : undefined,
      },
    }
  })
}

async function queryUnbans(
  client: DbClient,
  cursor: FeedPosition | undefined,
  banSource: BanSource | undefined,
  limit: number,
): Promise<FeedEntry[]> {
  const kind = ModerationActionKind.Unban
  const time = sql`b.unbanned_at`
  const result = await client.query<{
    id: string
    user_id: SbUserId
    time_us: string
    unbanned_by: SbUserId | null
    unban_reason: string | null
    source: BanSource
    cascaded_from: SbUserId | null
  }>(sql`
    SELECT b.id, b.user_id, ${microseconds(time)} AS time_us, b.unbanned_by, b.unban_reason,
      b.source, b.cascaded_from
    FROM user_bans b
    WHERE b.unbanned_at IS NOT NULL
      AND ${afterCursor(kind, time, sql`b.id`, 'uuid', cursor)}
      AND (${banSource ?? null}::text IS NULL OR b.source = ${banSource ?? null})
    ORDER BY b.unbanned_at DESC, b.id DESC
    LIMIT ${limit}
  `)

  return result.rows.map(row => {
    const timeUs = BigInt(row.time_us)
    return {
      position: { timeUs, kind, key: row.id },
      action: {
        kind,
        id: row.id,
        time: usToMs(timeUs),
        userId: row.user_id,
        unbannedBy: row.unbanned_by ?? undefined,
        reason: row.unban_reason ?? undefined,
        banSource: row.source,
        cascadedFrom: row.cascaded_from ?? undefined,
      },
    }
  })
}

async function queryRestrictions(
  client: DbClient,
  cursor: FeedPosition | undefined,
  restrictionKind: RestrictionKind | undefined,
  limit: number,
): Promise<FeedEntry[]> {
  const kind = ModerationActionKind.Restriction
  const time = sql`r.start_time`
  const result = await client.query<{
    id: string
    user_id: SbUserId
    time_us: string
    kind: RestrictionKind
    end_time: Date
    restricted_by: SbUserId | null
    reason: RestrictionReason | null
    admin_notes: string | null
    cascaded_from: SbUserId | null
    lifted_at: Date | null
  }>(sql`
    SELECT r.id, r.user_id, ${microseconds(time)} AS time_us, r.kind, r.end_time, r.restricted_by,
      r.reason, r.admin_notes, r.cascaded_from, r.lifted_at
    FROM user_restrictions r
    WHERE ${afterCursor(kind, time, sql`r.id`, 'uuid', cursor)}
      AND (${restrictionKind ?? null}::restriction_kind IS NULL OR r.kind = ${restrictionKind ?? null})
    ORDER BY r.start_time DESC, r.id DESC
    LIMIT ${limit}
  `)

  return result.rows.map(row => {
    const timeUs = BigInt(row.time_us)
    return {
      position: { timeUs, kind, key: row.id },
      action: {
        kind,
        id: row.id,
        time: usToMs(timeUs),
        userId: row.user_id,
        restrictionKind: row.kind,
        endTime: Number(row.end_time),
        restrictedBy: row.restricted_by ?? undefined,
        reason: row.reason ?? undefined,
        adminNotes: row.admin_notes ?? undefined,
        cascadedFrom: row.cascaded_from ?? undefined,
        liftedAt: row.lifted_at ? Number(row.lifted_at) : undefined,
      },
    }
  })
}

async function queryRestrictionLifts(
  client: DbClient,
  cursor: FeedPosition | undefined,
  restrictionKind: RestrictionKind | undefined,
  limit: number,
): Promise<FeedEntry[]> {
  const kind = ModerationActionKind.RestrictionLift
  const time = sql`r.lifted_at`
  const result = await client.query<{
    id: string
    user_id: SbUserId
    time_us: string
    kind: RestrictionKind
    lifted_by: SbUserId | null
    lift_reason: string | null
    cascaded_from: SbUserId | null
  }>(sql`
    SELECT r.id, r.user_id, ${microseconds(time)} AS time_us, r.kind, r.lifted_by, r.lift_reason,
      r.cascaded_from
    FROM user_restrictions r
    WHERE r.lifted_at IS NOT NULL
      AND ${afterCursor(kind, time, sql`r.id`, 'uuid', cursor)}
      AND (${restrictionKind ?? null}::restriction_kind IS NULL OR r.kind = ${restrictionKind ?? null})
    ORDER BY r.lifted_at DESC, r.id DESC
    LIMIT ${limit}
  `)

  return result.rows.map(row => {
    const timeUs = BigInt(row.time_us)
    return {
      position: { timeUs, kind, key: row.id },
      action: {
        kind,
        id: row.id,
        time: usToMs(timeUs),
        userId: row.user_id,
        restrictionKind: row.kind,
        liftedBy: row.lifted_by ?? undefined,
        reason: row.lift_reason ?? undefined,
        cascadedFrom: row.cascaded_from ?? undefined,
      },
    }
  })
}

async function queryMatchmakingBans(
  client: DbClient,
  cursor: FeedPosition | undefined,
  limit: number,
): Promise<FeedEntry[]> {
  const kind = ModerationActionKind.MatchmakingBan
  const time = sql`m.created_at`
  // A single ban writes one row per identifier, all sharing `created_at` and `triggered_by`
  const result = await client.query<{
    id: string
    user_id: SbUserId
    time_us: string
    expires_at: Date
    ban_level: number
  }>(sql`
    SELECT DISTINCT ON (m.created_at, m.triggered_by)
      m.id, m.triggered_by AS user_id, ${microseconds(time)} AS time_us, m.expires_at, m.ban_level
    FROM matchmaking_bans m
    WHERE m.triggered_by IS NOT NULL
      AND ${afterCursor(kind, time, sql`m.triggered_by`, 'int4', cursor)}
    ORDER BY m.created_at DESC, m.triggered_by DESC, m.id
    LIMIT ${limit}
  `)

  return result.rows.map(row => {
    const timeUs = BigInt(row.time_us)
    return {
      position: { timeUs, kind, key: row.user_id },
      action: {
        kind,
        id: row.id,
        time: usToMs(timeUs),
        userId: row.user_id,
        endTime: Number(row.expires_at),
        banLevel: row.ban_level,
      },
    }
  })
}

/**
 * Retrieves a page of moderation actions of the given kinds, newest first, starting after `cursor`
 * (if specified).
 */
export async function getModerationActions({
  kinds,
  banSource,
  restrictionKind,
  cursor,
  limit,
}: {
  kinds: ReadonlySet<ModerationActionKind>
  banSource?: BanSource
  restrictionKind?: RestrictionKind
  cursor?: string
  limit: number
}): Promise<{ actions: ModerationAction[]; nextCursor?: string }> {
  const position = cursor !== undefined ? decodeModerationCursor(cursor) : undefined
  // Each kind is fetched one past the page size so we know whether a further page exists
  const queryLimit = limit + 1

  const entries = await withDbClient(async client => {
    const results: FeedEntry[] = []
    // These run one at a time since they share a client
    if (kinds.has(ModerationActionKind.Ban)) {
      results.push(...(await queryBans(client, position, banSource, queryLimit)))
    }
    if (kinds.has(ModerationActionKind.Unban)) {
      results.push(...(await queryUnbans(client, position, banSource, queryLimit)))
    }
    if (kinds.has(ModerationActionKind.Restriction)) {
      results.push(...(await queryRestrictions(client, position, restrictionKind, queryLimit)))
    }
    if (kinds.has(ModerationActionKind.RestrictionLift)) {
      results.push(...(await queryRestrictionLifts(client, position, restrictionKind, queryLimit)))
    }
    if (kinds.has(ModerationActionKind.MatchmakingBan)) {
      results.push(...(await queryMatchmakingBans(client, position, queryLimit)))
    }
    return results
  })

  entries.sort((a, b) => comparePositions(a.position, b.position))
  const page = entries.slice(0, limit)
  return {
    actions: page.map(e => e.action),
    nextCursor:
      entries.length > limit ? encodeModerationCursor(page[page.length - 1].position) : undefined,
  }
}
