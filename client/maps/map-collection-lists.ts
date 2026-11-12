import { MapCollectionKind } from '../gql/graphql'

/** What deciding where a collection is listed needs to know about it. */
export interface ListedCollection {
  id: string
  kind: MapCollectionKind
  canEdit: boolean
}

/**
 * The collections a map can be added to from its page, each group in the order given: the viewer's
 * own collections (`own` is the viewer's list, which also holds Starred and the collections they
 * saved), and the staff collections they can change.
 */
export function addableCollections<C extends ListedCollection>(
  own: ReadonlyArray<C>,
  staff: ReadonlyArray<C>,
): { own: C[]; staff: C[] } {
  return {
    own: own.filter(c => c.kind === MapCollectionKind.User && c.canEdit),
    staff: staff.filter(c => c.kind === MapCollectionKind.Staff && c.canEdit),
  }
}

/**
 * `items` ordered by where their ids are in `order`. Items whose ids aren't in it come first, in the
 * order they're given, so a list kept in a fixed order still shows what was added to it since.
 */
export function inKeptOrder<T extends { id: string }>(
  items: ReadonlyArray<T>,
  order: ReadonlyArray<string>,
): T[] {
  const positions = new Map(order.map((id, i) => [id, i]))
  const added = items.filter(item => !positions.has(item.id))
  const kept = items
    .filter(item => positions.has(item.id))
    .sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)
  return [...added, ...kept]
}

/**
 * Splits a map's ladder pools into the ones their matchmaking types play now and the past ones,
 * each in the order given. A pool with no pool details counts as past.
 */
export function splitLadderPools<P extends { pool?: { isCurrent: boolean } | null }>(
  pools: ReadonlyArray<P>,
): { current: P[]; past: P[] } {
  return {
    current: pools.filter(p => !!p.pool?.isCurrent),
    past: pools.filter(p => !p.pool?.isCurrent),
  }
}
