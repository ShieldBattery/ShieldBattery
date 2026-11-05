import { SbMapId } from '../../common/maps'
import { MapFamilyRelation } from '../gql/graphql'

export interface FamilyLineMember {
  mapId: SbMapId
  parentId?: SbMapId
  relation: MapFamilyRelation
  isCurrent: boolean
  /** Milliseconds since the epoch. */
  firstSeenAt: number
}

/**
 * One map line of a family: the family's first file or a map based on another one, with its
 * versions and their copies.
 */
export interface FamilyLine {
  /** The line's first file. */
  topId: SbMapId
  /** The file this line's map is based on. Unset for the family's first line. */
  basedOnId?: SbMapId
  /** Newest version first, each followed by its copies. */
  rows: SbMapId[]
}

/** Whether a file starts a line of its own rather than continuing its parent's. */
function startsLine(member: FamilyLineMember, byId: ReadonlyMap<SbMapId, FamilyLineMember>) {
  return (
    !member.parentId ||
    !byId.has(member.parentId) ||
    member.relation === MapFamilyRelation.Root ||
    member.relation === MapFamilyRelation.Fork
  )
}

/** Whether a file is the same version as its parent rather than a version of its own. */
function isCopy(member: FamilyLineMember) {
  return (
    member.relation === MapFamilyRelation.Variant ||
    member.relation === MapFamilyRelation.Translation
  )
}

/**
 * Splits a family into its lines, the family's first line first and the rest in the order their
 * maps were first seen.
 */
export function familyLines(members: ReadonlyArray<FamilyLineMember>): FamilyLine[] {
  const byId = new Map(members.map(m => [m.mapId, m]))
  const byAge = [...members].sort((a, b) => a.firstSeenAt - b.firstSeenAt)
  const children = new Map<SbMapId, FamilyLineMember[]>()
  for (const member of byAge) {
    if (!startsLine(member, byId)) {
      const list = children.get(member.parentId!) ?? []
      list.push(member)
      children.set(member.parentId!, list)
    }
  }

  const lines: FamilyLine[] = []
  const tops = byAge.filter(m => startsLine(m, byId))
  // The family's first file goes first however old it is, since the other lines are based on it
  tops.sort(
    (a, b) =>
      Number(b.relation === MapFamilyRelation.Root) - Number(a.relation === MapFamilyRelation.Root),
  )
  for (const top of tops) {
    // Versions oldest first, depth-first so each one's newer versions follow it
    const versions: FamilyLineMember[] = []
    const copiesOf = new Map<SbMapId, SbMapId[]>()
    const visit = (member: FamilyLineMember, versionId: SbMapId) => {
      for (const child of children.get(member.mapId) ?? []) {
        if (isCopy(child)) {
          const copies = copiesOf.get(versionId) ?? []
          copies.push(child.mapId)
          copiesOf.set(versionId, copies)
          visit(child, versionId)
        } else {
          versions.push(child)
          visit(child, child.mapId)
        }
      }
    }
    versions.push(top)
    visit(top, top.mapId)

    const newestFirst = versions.reverse()
    // A line's latest file leads it even when a newer file isn't the one players are pointed at
    const latest = newestFirst.findIndex(
      v => v.isCurrent || copiesOf.get(v.mapId)?.some(id => byId.get(id)!.isCurrent),
    )
    if (latest > 0) {
      newestFirst.unshift(...newestFirst.splice(latest, 1))
    }

    lines.push({
      topId: top.mapId,
      basedOnId: top.relation === MapFamilyRelation.Fork ? top.parentId : undefined,
      rows: newestFirst.flatMap(v => [v.mapId, ...(copiesOf.get(v.mapId) ?? [])]),
    })
  }
  return lines
}

/** How many of a family's files the versions card shows before it's expanded. */
export const COLLAPSE_AT_ROWS = 5
/** How many lines besides the viewed file's own a collapsed versions card shows. */
const COLLAPSED_OTHER_LINES = 3

/**
 * Shortens a family's lines for a collapsed versions card: the viewed file's line keeps its latest
 * file, the viewed file and its first file, and up to a few other lines keep only their latest
 * file. Returns the lines unchanged if the family is too small to collapse.
 */
export function collapseFamilyLines(
  lines: ReadonlyArray<FamilyLine>,
  hereId: SbMapId,
  isCurrent: (id: SbMapId) => boolean,
): { lines: FamilyLine[]; hiddenCount: number } {
  const total = lines.reduce((sum, line) => sum + line.rows.length, 0)
  if (total < COLLAPSE_AT_ROWS) {
    return { lines: [...lines], hiddenCount: 0 }
  }

  const hereLine = lines.findIndex(line => line.rows.includes(hereId))
  let otherLines = 0
  const collapsed: FamilyLine[] = []
  lines.forEach((line, i) => {
    if (i === hereLine) {
      const keep = new Set([hereId, line.topId, line.rows.find(isCurrent) ?? line.rows[0]])
      collapsed.push({ ...line, rows: line.rows.filter(id => keep.has(id)) })
    } else if (otherLines < COLLAPSED_OTHER_LINES) {
      otherLines += 1
      collapsed.push({ ...line, rows: [line.rows.find(isCurrent) ?? line.rows[0]] })
    }
  })
  const shown = collapsed.reduce((sum, line) => sum + line.rows.length, 0)
  return shown < total
    ? { lines: collapsed, hiddenCount: total - shown }
    : { lines: [...lines], hiddenCount: 0 }
}
