import { SbMapId } from '../../common/maps'
import { MapFamilyRelation, MapVersionStatus } from '../gql/graphql'

export interface PreviewMember {
  mapId: SbMapId
  parentId: SbMapId | undefined
  relation: MapFamilyRelation
  versionLabel: string | undefined
  pinnedCurrent: boolean
  listed: boolean
  /** Milliseconds since the epoch. */
  firstSeenAt: number
}

export interface PreviewPlace {
  isCurrent: boolean
  status: MapVersionStatus
}

interface VersionKey {
  major: number
  minor: number
  patch: number
  suffix: string
}

const VERSION_PARTS = /^(\d*)(?:\.(\d+))?(?:\.(\d+))?([a-z]?)$/

/** Parses a version label the way the server orders a line's versions ("1.3", "2.0.1b"). */
export function parseVersionKey(version: string): VersionKey | undefined {
  const parts = VERSION_PARTS.exec(version.toLowerCase())
  if (!parts) {
    return undefined
  }
  const whole = parts[1] ? Number(parts[1]) : 0
  const suffix = parts[4]
  if (parts[2] !== undefined && parts[3] !== undefined) {
    return { major: whole, minor: Number(parts[2]), patch: Number(parts[3]), suffix }
  } else if (parts[2] !== undefined) {
    return { major: Number(`${whole}.${parts[2]}`), minor: 0, patch: 0, suffix }
  } else {
    return { major: whole, minor: 0, patch: 0, suffix }
  }
}

/** Compares version keys, with no version ordering before any version. */
function compareVersionKeys(a: VersionKey | undefined, b: VersionKey | undefined): number {
  if (!a || !b) {
    return Number(!!a) - Number(!!b)
  }
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    Number(a.suffix > b.suffix) - Number(a.suffix < b.suffix)
  )
}

/**
 * Works out which file is each line's latest and how every other file relates to it, the same way
 * the server does once the files are saved in these places: the pinned file (unless it's unlisted
 * while another file of the line is listed), else the deepest listed version (version label, then
 * first seen, breaking ties). A copy is only the latest when it's listed and its version isn't.
 */
export function previewFamily(
  members: ReadonlyArray<PreviewMember>,
): ReadonlyMap<SbMapId, PreviewPlace> {
  const byId = new Map(members.map(m => [m.mapId, m]))
  const startsLine = (m: PreviewMember) =>
    m.relation === MapFamilyRelation.Root ||
    m.relation === MapFamilyRelation.Fork ||
    !m.parentId ||
    !byId.has(m.parentId)
  const isCopy = (m: PreviewMember) =>
    m.relation === MapFamilyRelation.Variant || m.relation === MapFamilyRelation.Translation

  const places = new Map<SbMapId, { root: SbMapId; depth: number }>()
  for (const member of members) {
    const path = [member]
    let current = member
    while (!startsLine(current) && path.length <= members.length) {
      current = byId.get(current.parentId!)!
      path.push(current)
    }
    let root = current.mapId
    let depth = 0
    for (const m of path.reverse()) {
      if (startsLine(m)) {
        root = m.mapId
        depth = 0
      } else if (m.relation === MapFamilyRelation.Version) {
        depth += 1
      }
    }
    places.set(member.mapId, { root, depth })
  }

  const lines = new Map<SbMapId, PreviewMember[]>()
  for (const member of members) {
    const root = places.get(member.mapId)!.root
    lines.set(root, [...(lines.get(root) ?? []), member])
  }
  const currentOfLine = new Map<SbMapId, SbMapId>()
  for (const [root, line] of lines) {
    const anyListed = line.some(m => m.listed)
    const pinned = line.find(m => m.pinnedCurrent && (m.listed || !anyListed))
    if (pinned) {
      currentOfLine.set(root, pinned.mapId)
      continue
    }
    const isVersion = (m: PreviewMember) =>
      m.mapId === root || m.relation === MapFamilyRelation.Version
    const candidates = line.filter(m => isVersion(m) || (m.listed && isCopy(m)))
    const compare = (x: PreviewMember, y: PreviewMember) =>
      Number(x.listed) - Number(y.listed) ||
      places.get(x.mapId)!.depth - places.get(y.mapId)!.depth ||
      Number(isVersion(x)) - Number(isVersion(y)) ||
      compareVersionKeys(
        x.versionLabel ? parseVersionKey(x.versionLabel) : undefined,
        y.versionLabel ? parseVersionKey(y.versionLabel) : undefined,
      ) ||
      x.firstSeenAt - y.firstSeenAt
    const best = candidates.reduce<PreviewMember | undefined>(
      (acc, m) => (!acc || compare(m, acc) > 0 ? m : acc),
      undefined,
    )
    currentOfLine.set(root, best?.mapId ?? root)
  }

  const versionOf = (id: SbMapId) => {
    let member = byId.get(id)
    for (let steps = 0; member && isCopy(member) && steps <= members.length; steps++) {
      member = member.parentId ? byId.get(member.parentId) : undefined
    }
    return member?.mapId
  }
  const isStrictAncestor = (ancestor: SbMapId, id: SbMapId) => {
    let current = byId.get(id)?.parentId
    for (let steps = 0; current && steps <= members.length; steps++) {
      if (current === ancestor) {
        return true
      }
      current = byId.get(current)?.parentId
    }
    return false
  }

  const result = new Map<SbMapId, PreviewPlace>()
  for (const member of members) {
    const current = currentOfLine.get(places.get(member.mapId)!.root)!
    let status: MapVersionStatus
    if (current === member.mapId) {
      status = MapVersionStatus.Current
    } else if (member.relation === MapFamilyRelation.Variant) {
      status = MapVersionStatus.Variant
    } else if (member.relation === MapFamilyRelation.Translation) {
      status = MapVersionStatus.Translation
    } else {
      const currentVersion = versionOf(current)
      status =
        currentVersion && isStrictAncestor(member.mapId, currentVersion)
          ? MapVersionStatus.Superseded
          : MapVersionStatus.None
    }
    result.set(member.mapId, { isCurrent: status === MapVersionStatus.Current, status })
  }
  return result
}
