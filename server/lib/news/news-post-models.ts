import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

export interface LatestPublishedNewsPost {
  id: string
  publishedAt: Date
}
type DbLatestPublishedNewsPost = Dbify<LatestPublishedNewsPost>

export interface PublishedNewsPostMeta {
  title: string
  summary: string
  coverImagePath: string | null
  publishedAt: Date
}
type DbPublishedNewsPostMeta = Dbify<PublishedNewsPostMeta>

/**
 * Returns the id and publish time of the most recently published news post (that is, the newest
 * post whose `published_at` is set and has already passed), or `undefined` if no posts are
 * currently published.
 */
export async function getLatestPublishedNewsPost(
  withClient?: DbClient,
): Promise<LatestPublishedNewsPost | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbLatestPublishedNewsPost>(sql`
      SELECT id, published_at
      FROM news_posts
      WHERE published_at IS NOT NULL AND published_at <= NOW()
      ORDER BY published_at DESC, id DESC
      LIMIT 1;
    `)
    if (result.rows.length === 0) {
      return undefined
    }
    return {
      id: result.rows[0].id,
      publishedAt: result.rows[0].published_at,
    }
  } finally {
    done()
  }
}

/**
 * Returns the earliest future `published_at` among scheduled news posts (those whose publish time
 * hasn't passed yet), or `undefined` if none are scheduled.
 */
export async function getNextScheduledNewsPostTime(
  withClient?: DbClient,
): Promise<Date | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ next_published_at: Date | null }>(sql`
      SELECT MIN(published_at) AS next_published_at
      FROM news_posts
      WHERE published_at > NOW();
    `)
    return result.rows[0]?.next_published_at ?? undefined
  } finally {
    done()
  }
}

/**
 * Returns the title, summary, cover image path, and publish time of a published news post by id,
 * or `undefined` if it doesn't exist or isn't currently published.
 */
export async function getPublishedNewsPostMeta(
  id: string,
  withClient?: DbClient,
): Promise<PublishedNewsPostMeta | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbPublishedNewsPostMeta>(sql`
      SELECT title, summary, cover_image_path, published_at
      FROM news_posts
      WHERE id = ${id} AND published_at IS NOT NULL AND published_at <= NOW();
    `)
    if (result.rows.length === 0) {
      return undefined
    }
    const row = result.rows[0]
    return {
      title: row.title,
      summary: row.summary,
      coverImagePath: row.cover_image_path,
      publishedAt: row.published_at,
    }
  } finally {
    done()
  }
}
