import { weekDateString, weekStartOf } from '../../../common/map-feature-weeks'
import { makeMapCollectionId, makeMapFamilyId, MapInfoKind } from '../../../common/maps'
import { MapFeaturedNotificationPick } from '../../../common/notifications'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'
import { Dbify } from '../db/types'

/**
 * Arbitrary key for the advisory lock that makes claiming and releasing map feature notifications
 * take turns, so a claim always sees whether the other slot's pick of the same collection was
 * announced.
 */
const MAP_FEATURE_NOTIFICATION_LOCK_KEY = 4_118_790_532

/** A weekly pick claimed for its notification, with what that notification needs. */
export interface ClaimedMapFeature {
  /** When the pick's week starts: a Monday at 00:00 UTC. */
  week: Date
  /**
   * The slots of the week the notification is for: the pick's slot, or both when the same
   * collection fills both and neither had been announced.
   */
  kinds: MapInfoKind[]
  /** What the pick points at, named by the map's current file or the collection's title. */
  pick: MapFeaturedNotificationPick
  /** Who should be told about the pick, if anyone. */
  userId?: SbUserId
}

interface ClaimedMapFeatureRow {
  week: Date
  kind: MapInfoKind
  familyId: string | null
  collectionId: string | null
  name: string | null
  userId: SbUserId | null
  alreadyTold: boolean
}

async function lockNotifications(client: DbClient) {
  await client.query(sql`SELECT pg_advisory_xact_lock(${MAP_FEATURE_NOTIFICATION_LOCK_KEY})`)
}

/**
 * Marks every pick of the week holding `now` (one per slot) as notified, if nobody has been told
 * about it yet, and returns the notifications they call for, so each pick is claimed at most once
 * however many server processes try. Returns nothing when the week has no picks or they were all
 * claimed already. Only the running week is ever claimed: a pick whose week ended unannounced
 * stays that way.
 *
 * A collection is announced once per week even when it fills both slots. Claimed together, its two
 * slots make one notification. A slot claimed after the other slot's announcement of the same
 * collection is marked with that announcement's time, and calls for no notification.
 *
 * The user to tell is, for a map, its maker, or when it has none the publisher of its current
 * file, and nobody while the map isn't listed or its current file isn't of the slot's kind. For a
 * collection it's the owner of a public player collection; staff collections and ladder pools have
 * nobody to tell.
 */
export async function claimMapFeatureNotifications(now: Date): Promise<ClaimedMapFeature[]> {
  const week = weekStartOf(now)
  // Run within the claiming statement, so it reads the slots as they were before the statement
  // claimed any of them
  const toldAt = sql`
    (
      SELECT told.notified_at
      FROM map_features AS told
      WHERE told.week = mf.week
        AND told.kind <> mf.kind
        AND told.collection_id = mf.collection_id
        AND told.notified_at IS NOT NULL
    )
  `
  const rows = await transact(async client => {
    await lockNotifications(client)
    const result = await client.query<Dbify<ClaimedMapFeatureRow>>(sql`
      WITH claimed AS (
        UPDATE map_features AS mf
        SET notified_at = COALESCE(${toldAt}, ${now})
        WHERE mf.week = ${weekDateString(week)}::date AND mf.notified_at IS NULL
        RETURNING mf.kind, mf.family_id, mf.collection_id, ${toldAt} IS NOT NULL AS already_told
      )
      SELECT
        ${week}::timestamptz AS week,
        claimed.kind,
        claimed.family_id,
        claimed.collection_id,
        claimed.already_told,
        CASE WHEN claimed.family_id IS NOT NULL THEN cur.name ELSE c.title END AS name,
        CASE
          WHEN claimed.family_id IS NOT NULL THEN
            CASE
              WHEN fam.listed AND cur.kind = claimed.kind THEN
                COALESCE(fam.owner_id, cur.published_by)
            END
          WHEN c.kind = 'user' AND c.published_at IS NOT NULL AND c.hidden_at IS NULL THEN
            c.owner_id
        END AS user_id
      FROM claimed
      LEFT JOIN map_families fam ON fam.id = claimed.family_id
      LEFT JOIN maps cur ON cur.id = fam.current_map_id
      LEFT JOIN collections c ON c.id = claimed.collection_id
      ORDER BY claimed.kind
    `)
    return result.rows
  })

  const claimed: ClaimedMapFeature[] = []
  const byCollection = new Map<string, ClaimedMapFeature>()
  for (const row of rows) {
    if (row.already_told) {
      continue
    }
    const name = row.name ?? ''
    const userId = row.user_id ?? undefined
    if (row.family_id) {
      claimed.push({
        week: row.week,
        kinds: [row.kind],
        pick: { kind: 'map', id: makeMapFamilyId(row.family_id), name },
        userId,
      })
    } else if (row.collection_id) {
      const existing = byCollection.get(row.collection_id)
      if (existing) {
        existing.kinds.push(row.kind)
        continue
      }
      const feature: ClaimedMapFeature = {
        week: row.week,
        kinds: [row.kind],
        pick: { kind: 'collection', id: makeMapCollectionId(row.collection_id), name },
        userId,
      }
      byCollection.set(row.collection_id, feature)
      claimed.push(feature)
    }
  }
  return claimed
}

/**
 * Clears the notification claim made at `claimedAt` for `claimed`, so a later
 * `claimMapFeatureNotifications` during its week returns it again. Only the slots of that claim
 * are cleared: its `kinds`, and for a collection the other slot if it was marked with the same
 * claim because it holds the same collection. A claim made at another time (on a pick that
 * replaced the one claimed, say) is left alone.
 */
export async function releaseMapFeatureNotificationClaim(
  claimed: Pick<ClaimedMapFeature, 'week' | 'kinds' | 'pick'>,
  claimedAt: Date,
): Promise<void> {
  const collectionId = claimed.pick.kind === 'collection' ? claimed.pick.id : null
  await transact(async client => {
    await lockNotifications(client)
    await client.query(sql`
      UPDATE map_features
      SET notified_at = NULL
      WHERE week = ${weekDateString(claimed.week)}::date
        AND notified_at = ${claimedAt}
        AND (kind = ANY(${claimed.kinds}) OR collection_id = ${collectionId})
    `)
  })
}
