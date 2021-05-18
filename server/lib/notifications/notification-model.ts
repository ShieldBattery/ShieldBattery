import sql from 'sql-template-strings'
import { NotificationType } from '../../../common/notifications'
import db from '../db/index'
import { Dbify } from '../db/types'

export interface BaseNotificationData {
  readonly type: NotificationType
}

export interface PartyInviteNotificationData extends BaseNotificationData {
  type: typeof NotificationType.PartyInvite
  from: string
  partyId: string
}

export type NotificationData = PartyInviteNotificationData

export interface Notification {
  id: string
  userId: number
  read: boolean
  visible: boolean
  createdAt: Date
  data: NotificationData
}

type DbNotification = Dbify<Notification>

function fromDbNotification(result: Readonly<DbNotification>): Notification {
  return {
    id: result.id,
    userId: result.user_id,
    read: result.read,
    visible: result.visible,
    createdAt: result.created_at,
    data: result.data,
  }
}

/**
 * Retrieves the list of 100 visible notifications for a particular user by default, ordered by the
 * time they were created.
 */
export async function retrieveNotifications({
  userId,
  type,
  visible = true,
  limit = 100,
}: {
  userId: number
  type?: string
  visible?: boolean
  limit?: number
}): Promise<Notification[]> {
  const { client, done } = await db()
  try {
    const query = sql`
      SELECT id, user_id, read, visible, created_at, data
      FROM notifications
      WHERE user_id = ${userId} AND visible = ${visible}
    `

    if (type !== undefined) {
      query.append(sql` AND data->>'type' = ${type}`)
    }

    query.append(sql`
      ORDER BY created_at DESC
      LIMIT ${limit};
    `)

    const result = await client.query<DbNotification>(query)
    return result.rows.map(n => fromDbNotification(n))
  } finally {
    done()
  }
}

/**
 * Creates a new notification with the given data and persists it to the DB. Notifications are
 * created as unread, but visible by default.
 */
export async function addNotification({
  userId,
  data,
  createdAt = new Date(),
}: {
  userId: number
  data: NotificationData
  createdAt?: Date
}): Promise<Notification> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbNotification>(sql`
      INSERT INTO notifications (user_id, created_at, data)
      VALUES (${userId}, ${createdAt}, ${data})
      RETURNING *;
    `)

    return fromDbNotification(result.rows[0])
  } finally {
    done()
  }
}

/**
 * Marks the given notification(s) for a particular user as read.
 */
export async function markRead(userId: number, notificationIds: string[]): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      UPDATE notifications
      SET read = true
      WHERE user_id = ${userId} AND id = ANY(${notificationIds});
    `)
  } finally {
    done()
  }
}

/**
 * Marks all notifications before a given timestamp for a particular user as not visible, i.e.
 * cleared.
 */
export async function clear(userId: number, timestamp: number): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      UPDATE notifications
      SET visible = false
      WHERE user_id = ${userId} AND created_at <= ${new Date(timestamp)};
    `)
  } finally {
    done()
  }
}

/**
 * Marks the given notification for a particular user as not visible, i.e. cleared.
 */
export async function clearById(userId: number, notificationId: string): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      UPDATE notifications
      SET visible = false
      WHERE user_id = ${userId} AND id = ${notificationId};
    `)
  } finally {
    done()
  }
}
