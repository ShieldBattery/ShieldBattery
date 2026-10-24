import { describe, expect, test } from 'vitest'
import { makeSbMapId, SbMapId } from '../../common/maps'
import { MapFamilyRelation, MapLinkSuggestionDecision } from '../gql/graphql'
import {
  FamilyEditorFile,
  FamilyPlacement,
  orderRows,
  parentOptions,
  placeFile,
  planFamilyEdits,
} from './family-editor'

const A = makeSbMapId('00000000-0000-0000-0000-00000000000a')
const B = makeSbMapId('00000000-0000-0000-0000-00000000000b')
const C = makeSbMapId('00000000-0000-0000-0000-00000000000c')
const D = makeSbMapId('00000000-0000-0000-0000-00000000000d')

function tree(
  parentId: SbMapId | undefined,
  relation = parentId ? MapFamilyRelation.Version : MapFamilyRelation.Root,
  versionLabel = '',
): FamilyPlacement {
  return { kind: 'tree', parentId, relation, versionLabel }
}

function file(id: SbMapId, firstSeenAt: number, initial: FamilyPlacement, inFamily = false) {
  return { id, firstSeenAt, initial, inFamily } satisfies FamilyEditorFile
}

function initialPlacements(files: FamilyEditorFile[]) {
  return new Map(files.map(f => [f.id, f.initial]))
}

describe('client/maps/family-editor', () => {
  test('orders each tree depth-first, oldest first, with left-out files last', () => {
    const files = [
      file(D, 1, { kind: 'decided', decision: MapLinkSuggestionDecision.Rejected }),
      file(C, 4, tree(A)),
      file(B, 3, tree(A)),
      file(A, 2, tree(undefined)),
    ]
    expect(orderRows(files, initialPlacements(files))).toEqual([
      { id: A, depth: 0 },
      { id: B, depth: 1 },
      { id: C, depth: 1 },
      { id: D, depth: 0 },
    ])
  })

  test('never offers a file or its descendants as its parent', () => {
    const placements = new Map([
      [A, tree(undefined)],
      [B, tree(A)],
      [C, tree(B)],
      [D, { kind: 'decided', decision: MapLinkSuggestionDecision.Rejected } as const],
    ])
    expect(parentOptions(placements, B)).toEqual([A])
    expect(parentOptions(placements, A)).toEqual([])
    expect(parentOptions(placements, C)).toEqual([A, B])
  })

  test('takes the children of a file left out to the top of their own trees', () => {
    const placements = new Map([
      [A, tree(undefined)],
      [B, tree(A)],
      [C, tree(B)],
    ])
    const result = placeFile(placements, B, {
      kind: 'decided',
      decision: MapLinkSuggestionDecision.Rejected,
    })
    expect(result.get(C)).toEqual(tree(undefined))
  })

  test('links new files parents first, and leaves files that keep their place alone', () => {
    const files = [
      file(A, 1, tree(undefined), true),
      file(B, 2, tree(A), true),
      file(C, 3, tree(D, MapFamilyRelation.Version, '1.2')),
      file(D, 4, tree(B, MapFamilyRelation.Variant, '1.1')),
    ]
    const plan = planFamilyEdits(files, initialPlacements(files), [])
    expect(plan.links).toEqual([
      { mapId: D, parentId: B, relation: MapFamilyRelation.Variant, versionLabel: '1.1' },
      { mapId: C, parentId: D, relation: MapFamilyRelation.Version, versionLabel: '1.2' },
    ])
    expect(plan.labels).toEqual([])
    expect(plan.decisions).toEqual([])
  })

  test('relabels a file that keeps its place instead of relinking it', () => {
    const files = [file(A, 1, tree(undefined), true), file(B, 2, tree(A), true)]
    const placements = placeFile(initialPlacements(files), B, tree(A, undefined, ' 1.5 '))
    const plan = planFamilyEdits(files, placements, [])
    expect(plan.links).toEqual([])
    expect(plan.labels).toEqual([{ mapId: B, versionLabel: '1.5' }])
  })

  test('relabels the top of a new tree only once something joins it', () => {
    const files = [file(A, 1, tree(undefined, undefined, '1.0')), file(B, 2, tree(undefined))]
    const alone = placeFile(initialPlacements(files), A, tree(undefined, undefined, '1.1'))
    expect(planFamilyEdits(files, alone, []).labels).toEqual([])

    const joined = placeFile(alone, B, tree(A))
    const plan = planFamilyEdits(files, joined, [])
    expect(plan.links.map(l => l.mapId)).toEqual([B])
    expect(plan.labels).toEqual([{ mapId: A, versionLabel: '1.1' }])
  })

  test('moves a family member and closes the pairs of files left out', () => {
    const files = [
      file(A, 1, tree(undefined), true),
      file(B, 2, tree(undefined), true),
      file(C, 3, tree(A)),
    ]
    let placements = placeFile(initialPlacements(files), B, tree(A, MapFamilyRelation.Fork))
    placements = placeFile(placements, C, {
      kind: 'decided',
      decision: MapLinkSuggestionDecision.TerrainOnly,
    })
    const plan = planFamilyEdits(files, placements, [
      { mapA: A, mapB: B },
      { mapA: A, mapB: C },
    ])
    expect(plan.links).toEqual([
      { mapId: B, parentId: A, relation: MapFamilyRelation.Fork, versionLabel: null },
    ])
    expect(plan.decisions).toEqual([
      { mapA: A, mapB: C, decision: MapLinkSuggestionDecision.TerrainOnly },
    ])
  })
})
