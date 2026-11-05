import { describe, expect, test } from 'vitest'
import { makeSbMapId, SbMapId } from '../../common/maps'
import { MapFamilyRelation } from '../gql/graphql'
import { collapseFamilyLines, FamilyLineMember, familyLines } from './map-family-lines'

const id = (n: number) => makeSbMapId(`00000000-0000-0000-0000-${String(n).padStart(12, '0')}`)
const [A, B, C, D, E, F, G] = [1, 2, 3, 4, 5, 6, 7].map(id)

function member(
  mapId: SbMapId,
  firstSeenAt: number,
  parentId?: SbMapId,
  relation = parentId ? MapFamilyRelation.Version : MapFamilyRelation.Root,
  isCurrent = false,
): FamilyLineMember {
  return { mapId, parentId, relation, isCurrent, firstSeenAt }
}

describe('client/maps/map-family-lines', () => {
  test('lists a line newest version first, each followed by its copies', () => {
    const lines = familyLines([
      member(A, 1),
      member(B, 2, A, MapFamilyRelation.Variant),
      member(C, 3, A),
      member(D, 4, C, MapFamilyRelation.Version, true),
      member(E, 5, D, MapFamilyRelation.Translation),
    ])
    expect(lines).toEqual([{ topId: A, basedOnId: undefined, rows: [D, E, C, A, B] }])
  })

  test('gives each map based on another its own line after the first one', () => {
    const lines = familyLines([
      member(B, 2, A, MapFamilyRelation.Fork),
      member(A, 3, undefined, MapFamilyRelation.Root, true),
      member(C, 4, B, MapFamilyRelation.Version, true),
    ])
    expect(lines).toEqual([
      { topId: A, basedOnId: undefined, rows: [A] },
      { topId: B, basedOnId: A, rows: [C, B] },
    ])
  })

  test('puts the latest file first when a newer one is not it', () => {
    const lines = familyLines([
      member(A, 1),
      member(B, 2, A, MapFamilyRelation.Version, true),
      member(C, 3, B),
    ])
    expect(lines[0].rows).toEqual([B, C, A])
  })

  test('puts the version of a copy standing in as latest first', () => {
    const lines = familyLines([
      member(A, 1),
      member(B, 2, A, MapFamilyRelation.Variant, true),
      member(C, 3, A),
    ])
    expect(lines[0].rows).toEqual([A, B, C])
  })

  test("collapses to the viewed file's line ends and the other lines' latest files", () => {
    const lines = familyLines([
      member(A, 1),
      member(B, 2, A),
      member(C, 3, B),
      member(D, 4, C, MapFamilyRelation.Version, true),
      member(E, 5, A, MapFamilyRelation.Fork),
      member(F, 6, E, MapFamilyRelation.Version, true),
    ])
    const current = new Set([D, F])
    expect(collapseFamilyLines(lines, B, x => current.has(x))).toEqual({
      lines: [
        { topId: A, basedOnId: undefined, rows: [D, B, A] },
        { topId: E, basedOnId: A, rows: [F] },
      ],
      hiddenCount: 2,
    })
  })

  test('leaves small families and ones with nothing to hide expanded', () => {
    const small = familyLines([member(A, 1), member(B, 2, A, MapFamilyRelation.Version, true)])
    expect(collapseFamilyLines(small, A, x => x === B)).toEqual({ lines: small, hiddenCount: 0 })

    const nothingHidden = familyLines([
      member(A, 1),
      member(B, 2, A, MapFamilyRelation.Version, true),
      member(C, 3, A, MapFamilyRelation.Fork, true),
      member(D, 4, A, MapFamilyRelation.Fork, true),
      member(G, 5, A, MapFamilyRelation.Fork, true),
    ])
    expect(collapseFamilyLines(nothingHidden, A, () => false).hiddenCount).toBe(0)
  })
})
