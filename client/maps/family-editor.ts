import { SbMapId } from '../../common/maps'
import { MapFamilyRelation, MapLinkSuggestionDecision } from '../gql/graphql'

/** Where the family editor puts a file. */
export type FamilyPlacement =
  | {
      kind: 'tree'
      /** Undefined for the top of a tree. */
      parentId: SbMapId | undefined
      relation: MapFamilyRelation
      versionLabel: string
    }
  | {
      /** Leaves the file out of every family and closes its open pairs with this decision. */
      kind: 'decided'
      decision: MapLinkSuggestionDecision.Rejected | MapLinkSuggestionDecision.TerrainOnly
    }

export interface FamilyEditorFile {
  id: SbMapId
  /** Whether the file is in a family now. */
  inFamily: boolean
  /** Where the file is now (or, outside a family, where the rules propose to put it). */
  initial: FamilyPlacement
  /** Orders siblings, the oldest first. */
  firstSeenAt: number
}

export interface FamilyEditorPair {
  mapA: SbMapId
  mapB: SbMapId
}

export interface FamilyLinkPlan {
  mapId: SbMapId
  parentId: SbMapId
  relation: MapFamilyRelation
  versionLabel: string | null
}

export interface FamilyEditorPlan {
  /** Links in the order they must be applied: every parent is placed before its children. */
  links: FamilyLinkPlan[]
  /** Version label changes of files that keep their place. Applied after `links`. */
  labels: Array<{ mapId: SbMapId; versionLabel: string | null }>
  /** Decisions for open pairs of files left out of the families. */
  decisions: Array<{ mapA: SbMapId; mapB: SbMapId; decision: MapLinkSuggestionDecision }>
}

export type FamilyPlacements = ReadonlyMap<SbMapId, FamilyPlacement>

function parentOf(placements: FamilyPlacements, id: SbMapId): SbMapId | undefined {
  const placement = placements.get(id)
  return placement?.kind === 'tree' ? placement.parentId : undefined
}

/** Whether `ancestor` is `id` or above it in the tree. */
export function isAncestorOrSelf(
  placements: FamilyPlacements,
  ancestor: SbMapId,
  id: SbMapId,
): boolean {
  let current: SbMapId | undefined = id
  for (let steps = 0; current && steps <= placements.size; steps++) {
    if (current === ancestor) {
      return true
    }
    current = parentOf(placements, current)
  }
  return false
}

/** The files `id` can be placed under: every file in a tree except itself and its descendants. */
export function parentOptions(placements: FamilyPlacements, id: SbMapId): SbMapId[] {
  return Array.from(placements.entries())
    .filter(([other, p]) => p.kind === 'tree' && !isAncestorOrSelf(placements, id, other))
    .map(([other]) => other)
}

/**
 * Changes a file's placement. A file taken out of the trees takes its children with it as the
 * tops of their own trees.
 */
export function placeFile(
  placements: FamilyPlacements,
  id: SbMapId,
  placement: FamilyPlacement,
): Map<SbMapId, FamilyPlacement> {
  const result = new Map(placements)
  result.set(id, placement)
  if (placement.kind !== 'tree') {
    for (const [other, p] of result) {
      if (p.kind === 'tree' && p.parentId === id) {
        result.set(other, { ...p, parentId: undefined, relation: MapFamilyRelation.Root })
      }
    }
  }
  return result
}

export interface FamilyEditorRow {
  id: SbMapId
  depth: number
}

/** The children of each file in the trees (and the tops, under `undefined`), in `byAge` order. */
function childrenByAge(
  byAge: ReadonlyArray<Pick<FamilyEditorFile, 'id'>>,
  placements: FamilyPlacements,
): Map<SbMapId | undefined, SbMapId[]> {
  const children = new Map<SbMapId | undefined, SbMapId[]>()
  for (const file of byAge) {
    const placement = placements.get(file.id)
    if (placement?.kind !== 'tree') {
      continue
    }
    const list = children.get(placement.parentId) ?? []
    list.push(file.id)
    children.set(placement.parentId, list)
  }
  return children
}

export interface FamilyTreeRow extends FamilyEditorRow {
  /** Whether the file branches off its parent rather than being its next version. */
  branch: boolean
}

/**
 * Orders the files in the trees for reading. A version sits level with the file before it, so a
 * line reads top to bottom from oldest to newest however long it is; variants, translations and
 * forks are indented under the file they come from, ahead of that file's next version so they stay
 * next to it. Siblings and trees go oldest first. Files left out of the trees aren't included.
 */
export function orderTreeRows(
  files: ReadonlyArray<Pick<FamilyEditorFile, 'id' | 'firstSeenAt'>>,
  placements: FamilyPlacements,
): FamilyTreeRow[] {
  const byAge = [...files].sort((a, b) => a.firstSeenAt - b.firstSeenAt)
  const children = childrenByAge(byAge, placements)
  const isVersion = (id: SbMapId) => {
    const placement = placements.get(id)
    return placement?.kind === 'tree' && placement.relation === MapFamilyRelation.Version
  }

  const rows: FamilyTreeRow[] = []
  const visit = (id: SbMapId, depth: number, branch: boolean) => {
    rows.push({ id, depth, branch })
    const kids = children.get(id) ?? []
    for (const child of kids) {
      if (!isVersion(child)) {
        visit(child, depth + 1, true)
      }
    }
    for (const child of kids) {
      if (isVersion(child)) {
        visit(child, depth, false)
      }
    }
  }
  for (const top of children.get(undefined) ?? []) {
    visit(top, 0, false)
  }
  return rows
}

/**
 * Orders the files for display: each tree depth-first under its top, siblings and trees oldest
 * first, then the files left out of the trees.
 */
export function orderRows(
  files: ReadonlyArray<Pick<FamilyEditorFile, 'id' | 'firstSeenAt'>>,
  placements: FamilyPlacements,
): FamilyEditorRow[] {
  const byAge = [...files].sort((a, b) => a.firstSeenAt - b.firstSeenAt)
  const children = childrenByAge(byAge, placements)

  const rows: FamilyEditorRow[] = []
  const visit = (id: SbMapId, depth: number) => {
    rows.push({ id, depth })
    for (const child of children.get(id) ?? []) {
      visit(child, depth + 1)
    }
  }
  for (const top of children.get(undefined) ?? []) {
    visit(top, 0)
  }
  for (const file of byAge) {
    if (placements.get(file.id)?.kind !== 'tree') {
      rows.push({ id: file.id, depth: 0 })
    }
  }
  return rows
}

function normalizeLabel(label: string): string | null {
  const trimmed = label.trim()
  return trimmed ? trimmed : null
}

/**
 * Works out the edits that turn the files' current places into `placements`. Files that keep
 * their parent and relation aren't relinked, so their place keeps its source.
 */
export function planFamilyEdits(
  files: ReadonlyArray<FamilyEditorFile>,
  placements: FamilyPlacements,
  openPairs: ReadonlyArray<FamilyEditorPair>,
): FamilyEditorPlan {
  const plan: FamilyEditorPlan = { links: [], labels: [], decisions: [] }

  for (const row of orderRows(files, placements)) {
    const file = files.find(f => f.id === row.id)!
    const placement = placements.get(row.id)!
    if (placement.kind !== 'tree') {
      continue
    }
    const initial = file.initial
    const label = normalizeLabel(placement.versionLabel)
    const initialLabel = initial.kind === 'tree' ? normalizeLabel(initial.versionLabel) : null
    const unchanged =
      initial.kind === 'tree' &&
      initial.parentId === placement.parentId &&
      initial.relation === placement.relation &&
      (file.inFamily || !placement.parentId)

    if (placement.parentId && !unchanged) {
      plan.links.push({
        mapId: row.id,
        parentId: placement.parentId,
        relation: placement.relation,
        versionLabel: label,
      })
    } else if (label !== initialLabel) {
      plan.labels.push({ mapId: row.id, versionLabel: label })
    }
  }

  // The top of a new tree only joins a family once something is linked under it
  const familyTops = new Set(plan.links.map(l => l.parentId))
  plan.labels = plan.labels.filter(
    l => files.find(f => f.id === l.mapId)!.inFamily || familyTops.has(l.mapId),
  )

  for (const pair of openPairs) {
    for (const id of [pair.mapA, pair.mapB]) {
      const placement = placements.get(id)
      if (placement?.kind === 'decided') {
        plan.decisions.push({ mapA: pair.mapA, mapB: pair.mapB, decision: placement.decision })
        break
      }
    }
  }

  return plan
}

/** Whether the plan changes anything. */
export function hasFamilyEdits(plan: FamilyEditorPlan): boolean {
  return plan.links.length > 0 || plan.labels.length > 0 || plan.decisions.length > 0
}
