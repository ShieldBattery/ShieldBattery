import { weekDateString, weekStartOf } from '../../../common/map-feature-weeks'
import { makeMapCollectionId, makeMapFamilyId } from '../../../common/maps'
import { MapFeaturedNotificationPick } from '../../../common/notifications'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

/** A weekly pick claimed for its notification, with what that notification needs. */
export interface ClaimedMapFeature {
  /** When the pick's week starts: a Monday at 00:00 UTC. */
  week: Date
  /** What the pick points at, named by the map's current file or the collection's title. */
  pick: MapFeaturedNotificationPick
  /** Who should be told about the pick, if anyone. */
  userId?: SbUserId
}

interface ClaimedMapFeatureRow {
  week: Date
  familyId: string | null
  collectionId: string | null
  name: string | null
  userId: SbUserId | null
}

/**
 * Marks the pick of the week holding `now` as notified, if nobody has been told about it yet, and
 * returns it. Returns nothing when the week has no pick or its pick was already claimed, so each
 * pick is claimed at most once however many server processes try. Only the running week is ever
 * claimed: a pick whose week ended unannounced stays that way.
 *
 * The user to tell is, for a map, its maker, or when it has none the publisher of its current
 * file, and nobody while the map isn't listed. For a collection it's the owner of a public player
 * collection; staff collections and ladder pools have nobody to tell.
 */
export async function claimMapFeatureNotification(
  now: Date,
  withClient?: DbClient,
): Promise<ClaimedMapFeature | undefined> {
  const week = weekStartOf(now)
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<Dbify<ClaimedMapFeatureRow>>(sql`
      WITH claimed AS (
        UPDATE map_features
        SET notified_at = ${now}
        WHERE week = ${weekDateString(week)}::date AND notified_at IS NULL
        RETURNING family_id, collection_id
      )
      SELECT
        ${week}::timestamptz AS week,
        claimed.family_id,
        claimed.collection_id,
        CASE WHEN claimed.family_id IS NOT NULL THEN cur.name ELSE c.title END AS name,
        CASE
          WHEN claimed.family_id IS NOT NULL THEN
            CASE WHEN fam.listed THEN COALESCE(fam.owner_id, cur.published_by) END
          WHEN c.kind = 'user' AND c.published_at IS NOT NULL AND c.hidden_at IS NULL THEN
            c.owner_id
        END AS user_id
      FROM claimed
      LEFT JOIN map_families fam ON fam.id = claimed.family_id
      LEFT JOIN maps cur ON cur.id = fam.current_map_id
      LEFT JOIN collections c ON c.id = claimed.collection_id
    `)
    if (!result.rows.length) {
      return undefined
    }

    const row = result.rows[0]
    const name = row.name ?? ''
    let pick: MapFeaturedNotificationPick
    if (row.family_id) {
      pick = { kind: 'map', id: makeMapFamilyId(row.family_id), name }
    } else if (row.collection_id) {
      pick = { kind: 'collection', id: makeMapCollectionId(row.collection_id), name }
    } else {
      return undefined
    }
    return { week: row.week, pick, userId: row.user_id ?? undefined }
  } finally {
    done()
  }
}

/**
 * Clears the notification claim made at `claimedAt` on the pick of the week starting at `week` (a
 * Monday at 00:00 UTC), so a later `claimMapFeatureNotification` during that week returns it
 * again. A claim made at another time (on a pick that replaced the one claimed, say) is left alone.
 */
export async function releaseMapFeatureNotificationClaim(
  week: Date,
  claimedAt: Date,
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      UPDATE map_features
      SET notified_at = NULL
      WHERE week = ${weekDateString(week)}::date AND notified_at = ${claimedAt}
    `)
  } finally {
    done()
  }
}
