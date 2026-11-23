import { MapCollectionId, SbMapId } from '../../../common/maps'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'

/** The kinds of map collection, as stored. */
export type MapCollectionKind = 'user' | 'starred' | 'staff' | 'ladder_pool'

/** What a map collection's page shows someone who isn't its owner. */
export interface MapCollectionPageInfo {
  id: MapCollectionId
  kind: MapCollectionKind
  /** Set for `user` and `staff` collections. */
  title?: string
  description: string
  /** The display name of the player whose collection it is. Unset for `staff` collections. */
  ownerName?: string
  /** Whether the owner made it public. Only `user` collections can be. */
  published: boolean
  /** Whether staff hid it. */
  hidden: boolean
  /** How many maps someone other than its owner sees in it: those whose map is listed. */
  listedMapCount: number
  /** The file shown for the first of those maps, in the collection's order. */
  firstListedMapId?: SbMapId
}

/** Loads what a map collection's page shows a visitor, or `undefined` if there's no such collection. */
export async function getMapCollectionPageInfo(
  id: MapCollectionId,
): Promise<MapCollectionPageInfo | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<{
      id: MapCollectionId
      kind: MapCollectionKind
      title: string | null
      description: string
      owner_name: string | null
      published: boolean
      hidden: boolean
      listed_map_count: string
      first_listed_map_id: SbMapId | null
    }>(sql`
      WITH entries AS (
        SELECT m.id AS map_id, cm.position, cm.added_at
        FROM collection_maps cm
        INNER JOIN maps m ON m.id = COALESCE(cm.map_id,
          (SELECT f.current_map_id FROM map_families f WHERE f.id = cm.family_id))
        INNER JOIN map_families fam ON fam.id = m.family_id
        WHERE cm.collection_id = ${id} AND fam.listed
      )
      SELECT c.id, c.kind, c.title, c.description,
        (SELECT u.name FROM users u WHERE u.id = c.owner_id) AS owner_name,
        c.published_at IS NOT NULL AS published, c.hidden_at IS NOT NULL AS hidden,
        (SELECT count(*) FROM entries) AS listed_map_count,
        (SELECT e.map_id FROM entries e
          ORDER BY e.position, e.added_at DESC NULLS LAST, e.map_id LIMIT 1) AS first_listed_map_id
      FROM collections c
      WHERE c.id = ${id}
    `)
    const row = result.rows[0]
    if (!row) {
      return undefined
    }
    return {
      id: row.id,
      kind: row.kind,
      title: row.title ?? undefined,
      description: row.description,
      ownerName: row.owner_name ?? undefined,
      published: row.published,
      hidden: row.hidden,
      listedMapCount: Number(row.listed_map_count),
      firstListedMapId: row.first_listed_map_id ?? undefined,
    }
  } finally {
    done()
  }
}

/**
 * Creates the `ladder_pool` collection of a ladder map pool that starts at `createdAt`, holding
 * `mapIds` (exact files, which must exist and not repeat) in that order. Run it on the client of the
 * transaction that creates the pool. Returns the new collection's id.
 */
export async function createLadderPoolCollection(
  client: DbClient,
  { createdAt, mapIds }: { createdAt: Date; mapIds: ReadonlyArray<SbMapId> },
): Promise<MapCollectionId> {
  const result = await client.query<{ id: MapCollectionId }>(sql`
    INSERT INTO collections (kind, created_at, updated_at)
    VALUES ('ladder_pool', ${createdAt}, ${createdAt})
    RETURNING id
  `)
  const id = result.rows[0].id
  await client.query(sql`
    INSERT INTO collection_maps (collection_id, map_id, position, added_at)
    SELECT ${id}, e.map_id, (e.pos - 1)::integer, ${createdAt}
    FROM unnest(${mapIds}::uuid[]) WITH ORDINALITY AS e(map_id, pos)
  `)
  return id
}

/** Deletes a collection, with its entries, saves and reports. */
export async function deleteCollection(client: DbClient, id: MapCollectionId): Promise<void> {
  await client.query(sql`
    DELETE FROM collections
    WHERE id = ${id}
  `)
}
