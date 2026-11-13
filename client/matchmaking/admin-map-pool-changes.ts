import { SbMapId } from '../../common/maps'

/** The parts of a map pool that a new pool based on it can change. */
export interface PoolContents {
  maps: ReadonlyArray<SbMapId>
  maxVetoCount: number
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * One line comparing a new pool to the pool it was based on, e.g.
 * `+2 maps · −1 map · 1 file changed · vetoes 3 → 2`, or `No changes`. A file that left the pool and
 * a file that joined it count as one changed file when `familyOf` says they're of the same map;
 * files whose map isn't known count as maps that left or joined.
 */
export function poolChangeSummary(
  base: PoolContents,
  next: PoolContents,
  familyOf: (mapId: SbMapId) => string | undefined,
): string {
  const baseIds = new Set(base.maps)
  const nextIds = new Set(next.maps)
  const removed = base.maps.filter(id => !nextIds.has(id))
  const added = next.maps.filter(id => !baseIds.has(id))

  const unmatchedAdded = [...added]
  let changedFiles = 0
  let removedMaps = 0
  for (const id of removed) {
    const familyId = familyOf(id)
    const match =
      familyId !== undefined ? unmatchedAdded.findIndex(a => familyOf(a) === familyId) : -1
    if (match === -1) {
      removedMaps += 1
    } else {
      changedFiles += 1
      unmatchedAdded.splice(match, 1)
    }
  }
  const addedMaps = unmatchedAdded.length

  const parts: string[] = []
  if (addedMaps) {
    parts.push(`+${plural(addedMaps, 'map', 'maps')}`)
  }
  if (removedMaps) {
    parts.push(`−${plural(removedMaps, 'map', 'maps')}`)
  }
  if (changedFiles) {
    parts.push(`${plural(changedFiles, 'file', 'files')} changed`)
  }
  if (base.maxVetoCount !== next.maxVetoCount) {
    parts.push(`vetoes ${base.maxVetoCount} → ${next.maxVetoCount}`)
  }
  return parts.length ? parts.join(' · ') : 'No changes'
}
