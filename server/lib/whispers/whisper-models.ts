import { SbChannelId } from '../../../common/chat'
import { SbUserId } from '../../../common/users/sb-user-id'
import { WhisperMessageType } from '../../../common/whispers'
import db from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

/** A user's whisper session with another user, along with their read position in it. */
export interface WhisperSessionEntry {
  targetId: SbUserId
  /** The user's last recorded read position in the session, if they have one. */
  lastReadTime: Date | undefined
}

export async function getWhisperSessionsForUser(userId: SbUserId): Promise<WhisperSessionEntry[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ target_id: SbUserId; last_read_time: Date | null }>(sql`
      SELECT ws.target_user_id AS target_id, ws.last_read_time,
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
 * clobber a newer position recorded by another, and clamped to `now()` so a client can't push the
 * position into the future. A silent no-op if the session doesn't exist (e.g. it was closed).
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
        COALESCE(last_read_time, '-infinity'::timestamptz), LEAST(${lastReadTime}, now())
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
 * Returns the IDs of the target users in a user's whisper sessions that have a message from that
 * target after the user's last recorded read position for the session. A session with no recorded
 * read position never counts as unread here, since there's nothing to compare newly-arrived
 * messages against; `markRead` establishes that baseline the first time a client reports one.
 * Every whisper message is a text message (`WhisperMessageData` has a single variant), so every
 * message from the target counts. A single set-based query over all of the user's sessions, rather
 * than one query per session. `sent` columns store naive UTC wall time (see the timestamp parser
 * setup in `server/lib/db`), so the read position is converted to naive UTC for the comparison
 * instead of being left to the connection's session time zone. The comparison works at millisecond
 * granularity (`sent >= read + 1ms` rather than `sent > read`): read positions arrive as epoch
 * milliseconds while `sent` keeps microseconds, so a full-precision strict comparison would leave
 * the newest message permanently unread.
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
              'infinity'::timestamp
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

export async function getMessagesForWhisperSession(
  userId1: SbUserId,
  userId2: SbUserId,
  limit = 50,
  beforeDate?: Date,
): Promise<WhisperMessage[]> {
  const [userLow, userHigh] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1]
  const { client, done } = await db()

  try {
    const result = await client.query<DbWhisperMessage>(sql`
      WITH messages AS (
        SELECT m.id, m.from_id AS "from", m.to_id AS "to", m.sent, m.data
        FROM whisper_messages AS m
        WHERE m.user_low  = ${userLow}::int4
          AND m.user_high = ${userHigh}::int4
          ${beforeDate !== undefined ? sql`AND m.sent < ${beforeDate}` : sql``}
        ORDER BY m.sent DESC
        LIMIT ${limit}
      )
      SELECT *
      FROM messages
      ORDER BY sent ASC;
    `)

    return result.rows.map(row => convertMessageFromDb(row))
  } finally {
    done()
  }
}
