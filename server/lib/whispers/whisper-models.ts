import { assertUnreachable } from '../../../common/assert-unreachable'
import { SbChannelId } from '../../../common/chat'
import { SbUserId } from '../../../common/users/sb-user-id'
import { WhisperMessageType } from '../../../common/whispers'
import { HistoryCursor } from '../chat/chat-models'
import db from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

/** A user's whisper session with another user, along with their read position in it. */
export interface WhisperSessionEntry {
  targetId: SbUserId
  /** The user's last recorded read position in the session, if they have one. */
  lastReadTime: Date | undefined
  /** When the user started this whisper session. */
  startDate: Date
}

export async function getWhisperSessionsForUser(userId: SbUserId): Promise<WhisperSessionEntry[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<{
      target_id: SbUserId
      last_read_time: Date | null
      start_date: Date
    }>(sql`
      SELECT ws.target_user_id AS target_id, ws.last_read_time, ws.start_date,
        COALESCE(wm.sent, ws.start_date) AS last_sent
      FROM whisper_sessions ws
      LEFT JOIN LATERAL (
        SELECT wm.sent
        FROM whisper_messages wm
        WHERE wm.user_low  = LEAST(${userId}, ws.target_user_id)::int4
          AND wm.user_high = GREATEST(${userId}, ws.target_user_id)::int4
        ORDER BY wm.sent DESC
        LIMIT 1
      ) wm ON TRUE
      WHERE ws.user_id = ${userId}
      ORDER BY last_sent DESC;
    `)
    return result.rows.map(row => ({
      targetId: row.target_id,
      lastReadTime: row.last_read_time ?? undefined,
      startDate: row.start_date,
    }))
  } finally {
    done()
  }
}

export async function startWhisperSession(userId: SbUserId, targetUserId: SbUserId): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      INSERT INTO whisper_sessions (user_id, target_user_id, start_date)
      VALUES (${userId}, ${targetUserId}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ON CONFLICT DO NOTHING;
    `)
  } finally {
    done()
  }
}

/**
 * Starts whisper sessions in both directions between two users (each user gets a session row
 * pointing at the other), in a single round trip.
 */
export async function startWhisperSessionsBothDirections(
  userIdA: SbUserId,
  userIdB: SbUserId,
): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      INSERT INTO whisper_sessions (user_id, target_user_id, start_date)
      VALUES
        (${userIdA}, ${userIdB}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
        (${userIdB}, ${userIdA}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ON CONFLICT DO NOTHING;
    `)
  } finally {
    done()
  }
}

/**
 * Advances a user's read position in a whisper conversation to `lastReadTime`. The update is
 * monotonic (never moves the stored position backward) so a stale report from one device can't
 * clobber a newer position recorded by another, clamped above by `now()` so a client can't push the
 * position into the future, and floored at the session's `start_date` so a first report from a
 * client that has scrolled far back can't park the position before the session began (which would
 * make the unread query scan history the session never covered). `start_date` stores naive UTC wall
 * time, so it's converted before being compared against the `timestamptz` read position. A silent
 * no-op if the session doesn't exist (e.g. it was closed).
 *
 * Returns the resulting stored read position, or `undefined` if the session doesn't exist (nothing
 * to update).
 */
export async function updateLastReadTime(
  userId: SbUserId,
  targetId: SbUserId,
  lastReadTime: Date,
): Promise<Date | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ last_read_time: Date }>(sql`
      UPDATE whisper_sessions
      SET last_read_time = GREATEST(
        COALESCE(last_read_time, '-infinity'::timestamptz),
        start_date AT TIME ZONE 'UTC',
        LEAST(${lastReadTime}, now())
      )
      WHERE user_id = ${userId} AND target_user_id = ${targetId}
      RETURNING last_read_time;
    `)
    return result.rows[0]?.last_read_time
  } finally {
    done()
  }
}

/**
 * Returns the IDs of the target users in a user's whisper sessions that have an unread message
 * from that target: one sent after the user's last recorded read position for the session, or —
 * when no read position has been recorded yet — sent at or after the session started. A session
 * row is created no later than the first message of a conversation (see `sendWhisperMessage`), so
 * a conversation the user has never opened counts as unread from its very first message;
 * `markRead` records a read position the first time a client reports one. Closing a session
 * deletes its row (and read position), so a conversation re-opened by a later message only counts
 * messages from the new `start_date` on — older history isn't resurrected as unread.
 * Every whisper message is a text message (`WhisperMessageData` has a single variant), so every
 * message from the target counts. A single set-based query over all of the user's sessions, rather
 * than one query per session. `sent` and `start_date` columns store naive UTC wall time (see the
 * timestamp parser setup in `server/lib/db`), so the read position is converted to naive UTC for
 * the comparison instead of being left to the connection's session time zone. The comparison works
 * at millisecond granularity (`sent >= read + 1ms` rather than `sent > read`): read positions
 * arrive as epoch milliseconds while `sent` keeps microseconds, so a full-precision strict
 * comparison would leave the newest message permanently unread.
 */
export async function getUnreadWhisperTargets(userId: SbUserId): Promise<SbUserId[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ target_user_id: SbUserId }>(sql`
      SELECT ws.target_user_id FROM whisper_sessions ws
      WHERE ws.user_id = ${userId}
        AND EXISTS (
          SELECT 1 FROM whisper_messages m
          WHERE m.user_low = LEAST(ws.user_id, ws.target_user_id)
            AND m.user_high = GREATEST(ws.user_id, ws.target_user_id)
            AND m.from_id = ws.target_user_id
            AND m.sent >= COALESCE(
              (ws.last_read_time AT TIME ZONE 'UTC') + interval '1 millisecond',
              ws.start_date
            )
        )
    `)
    return result.rows.map(row => row.target_user_id)
  } finally {
    done()
  }
}

export async function closeWhisperSession(userId: SbUserId, targetId: SbUserId): Promise<boolean> {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      DELETE FROM whisper_sessions
      WHERE user_id = ${userId} AND target_user_id = ${targetId};
    `)
    return !!result.rowCount
  } finally {
    done()
  }
}

interface BaseWhisperMessageData {
  readonly type: WhisperMessageType
}

interface WhisperTextMessageData extends BaseWhisperMessageData {
  type: typeof WhisperMessageType.TextMessage
  /**
   * A processed contents of the text message, where all user and channel mentions are replaced
   * with a custom piece of markup.
   */
  text: string
  /**
   * An array of user IDs that were mentioned in the text message. Will be `undefined` if there were
   * no users mentioned in this message.
   *
   * For legacy reasons the name of the field is just "mentions".
   */
  mentions?: SbUserId[]
  /**
   * An array of channel IDs that were mentioned in the text message. Will be `undefined` if there
   * were no channels mentioned in this message.
   */
  channelMentions?: SbChannelId[]
}

type WhisperMessageData = WhisperTextMessageData

export interface WhisperMessage {
  id: string
  from: SbUserId
  to: SbUserId
  sent: Date
  data: WhisperMessageData
}

type DbWhisperMessage = Dbify<WhisperMessage>

function convertMessageFromDb(dbMessage: DbWhisperMessage): WhisperMessage {
  return {
    id: dbMessage.id,
    from: dbMessage.from,
    to: dbMessage.to,
    sent: dbMessage.sent,
    data: dbMessage.data,
  }
}

export async function addMessageToWhisper(
  fromId: SbUserId,
  toId: SbUserId,
  messageData: WhisperMessageData,
): Promise<WhisperMessage> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbWhisperMessage>(sql`
      INSERT INTO whisper_messages (from_id, to_id, sent, data)
      VALUES (${fromId}, ${toId},
        CURRENT_TIMESTAMP AT TIME ZONE 'UTC', ${messageData})
      RETURNING id, from_id AS "from", to_id AS "to", sent, data;
    `)
    if (result.rows.length < 1) {
      throw new Error('No rows returned')
    }

    return convertMessageFromDb(result.rows[0])
  } finally {
    done()
  }
}

/**
 * A page of whisper session messages, along with whether messages exist beyond either edge of the
 * returned window (evaluated at query time via a `limit`+1 probe row per edge).
 */
export interface WhisperMessagePage {
  /** Messages in the page, ordered oldest to newest. */
  messages: WhisperMessage[]
  /** Whether messages older than the returned window exist. */
  hasMoreBefore: boolean
  /** Whether messages newer than the returned window exist. */
  hasMoreAfter: boolean
}

/**
 * Returns when a whisper message was sent, scoped to the conversation between `userId1` and
 * `userId2`, or `undefined` if it doesn't exist there (deleted, never existed, or belongs to a
 * different conversation).
 */
export async function getWhisperMessageSentTime(
  userId1: SbUserId,
  userId2: SbUserId,
  messageId: string,
): Promise<Date | undefined> {
  const [userLow, userHigh] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1]
  const { client, done } = await db()
  try {
    const result = await client.query<{ sent: Date }>(sql`
      SELECT sent
      FROM whisper_messages
      WHERE id = ${messageId} AND user_low = ${userLow}::int4 AND user_high = ${userHigh}::int4;
    `)
    return result.rows[0]?.sent
  } finally {
    done()
  }
}

/**
 * Returns the two participants of a whisper message (sender and recipient), or `undefined` if the
 * message doesn't exist.
 */
export async function getWhisperMessageParticipants(
  messageId: string,
): Promise<{ from: SbUserId; to: SbUserId } | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ from_id: SbUserId; to_id: SbUserId }>(sql`
      SELECT from_id, to_id
      FROM whisper_messages
      WHERE id = ${messageId};
    `)
    const row = result.rows[0]
    return row ? { from: row.from_id, to: row.to_id } : undefined
  } finally {
    done()
  }
}

export async function getMessagesForWhisperSession(
  userId1: SbUserId,
  userId2: SbUserId,
  limit = 50,
  cursor: HistoryCursor = { kind: 'newest' },
): Promise<WhisperMessagePage> {
  const [userLow, userHigh] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1]
  const { client, done } = await db()

  try {
    switch (cursor.kind) {
      case 'newest':
      case 'before': {
        const result = await client.query<DbWhisperMessage>(sql`
          SELECT m.id, m.from_id AS "from", m.to_id AS "to", m.sent, m.data
          FROM whisper_messages AS m
          WHERE m.user_low  = ${userLow}::int4
            AND m.user_high = ${userHigh}::int4
            ${cursor.kind === 'before' ? sql`AND m.sent < ${cursor.date}` : sql``}
          ORDER BY m.sent DESC
          LIMIT ${limit + 1};
        `)
        // A `limit`+1'th row means messages older than the page exist; it's dropped below rather
        // than returned.
        const hasMoreBefore = result.rows.length > limit
        const rows = hasMoreBefore ? result.rows.slice(0, limit) : result.rows

        return {
          messages: rows.map(row => convertMessageFromDb(row)).reverse(),
          hasMoreBefore,
          hasMoreAfter: cursor.kind === 'before',
        }
      }

      case 'after': {
        // The cursor names a message the caller already has, but arrives as epoch milliseconds
        // while `sent` keeps microseconds, so that message usually comes back at the head of the
        // page. The client drops it as a duplicate. Starting the page a millisecond later instead
        // would skip any message stored later within the cursor's millisecond, which is worse than
        // a duplicate.
        const result = await client.query<DbWhisperMessage>(sql`
          SELECT m.id, m.from_id AS "from", m.to_id AS "to", m.sent, m.data
          FROM whisper_messages AS m
          WHERE m.user_low  = ${userLow}::int4
            AND m.user_high = ${userHigh}::int4
            AND m.sent > ${cursor.date}
          ORDER BY m.sent ASC
          LIMIT ${limit + 1};
        `)
        // Ascending scan, so the extra probe row (if present) is the newest of the batch.
        const hasMoreAfter = result.rows.length > limit
        const rows = hasMoreAfter ? result.rows.slice(0, limit) : result.rows

        return {
          messages: rows.map(row => convertMessageFromDb(row)),
          hasMoreBefore: true,
          hasMoreAfter,
        }
      }

      case 'around': {
        // An around window is used to place the message at `date` near the top of a viewport, so
        // most of the window belongs to what renders below it: too little content below the
        // target leaves the viewport unable to scroll down to the position.
        const beforeLimit = Math.floor(limit / 3)
        const afterLimit = limit - beforeLimit
        // `is_before` lets the two halves be told apart in JS without comparing timestamps
        // against `cursor.date` there (the DB's microsecond-precision `sent` loses precision when
        // parsed into a JS `Date`, so that comparison has to stay server-side). Each half keeps
        // its own scan order in the output (`is_before DESC` groups before-half rows first, each
        // half internally ascending by `sent`), so the probe row for each half is always at a
        // fixed end: the before-half's oldest row, or the after-half's newest row.
        const result = await client.query<DbWhisperMessage & { is_before: boolean }>(sql`
          WITH before_half AS (
            SELECT m.id, m.from_id AS "from", m.to_id AS "to", m.sent, m.data
            FROM whisper_messages AS m
            WHERE m.user_low  = ${userLow}::int4
              AND m.user_high = ${userHigh}::int4
              AND m.sent < ${cursor.date}
            ORDER BY m.sent DESC
            LIMIT ${beforeLimit + 1}
          ), after_half AS (
            SELECT m.id, m.from_id AS "from", m.to_id AS "to", m.sent, m.data
            FROM whisper_messages AS m
            WHERE m.user_low  = ${userLow}::int4
              AND m.user_high = ${userHigh}::int4
              AND m.sent >= ${cursor.date}
            ORDER BY m.sent ASC
            LIMIT ${afterLimit + 1}
          )
          SELECT *, TRUE AS is_before FROM before_half
          UNION ALL
          SELECT *, FALSE AS is_before FROM after_half
          ORDER BY is_before DESC, sent ASC;
        `)

        const beforeRows = result.rows.filter(row => row.is_before)
        const afterRows = result.rows.filter(row => !row.is_before)
        const hasMoreBefore = beforeRows.length > beforeLimit
        const hasMoreAfter = afterRows.length > afterLimit
        // Both halves are already in ascending order (see the query comment above), so the probe
        // sits at a known end: the before-half's first (oldest) row, or the after-half's last
        // (newest) row.
        const trimmedBefore = hasMoreBefore ? beforeRows.slice(1) : beforeRows
        const trimmedAfter = hasMoreAfter ? afterRows.slice(0, -1) : afterRows

        return {
          messages: [...trimmedBefore, ...trimmedAfter].map(row => convertMessageFromDb(row)),
          hasMoreBefore,
          hasMoreAfter,
        }
      }

      default:
        return assertUnreachable(cursor)
    }
  } finally {
    done()
  }
}
