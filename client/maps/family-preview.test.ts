import { describe, expect, test } from 'vitest'
import { makeSbMapId, SbMapId } from '../../common/maps'
import { MapFamilyRelation, MapVersionStatus } from '../gql/graphql'
import { parseVersionKey, previewFamily, PreviewMember } from './family-preview'

const id = (n: number) => makeSbMapId(`00000000-0000-0000-0000-${String(n).padStart(12, '0')}`)
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map(id)

function member(
  mapId: SbMapId,
  firstSeenAt: number,
  parentId?: SbMapId,
  relation = parentId ? MapFamilyRelation.Version : MapFamilyRelation.Root,
  extra: Partial<PreviewMember> = {},
): PreviewMember {
  return {
    mapId,
    parentId,
    relation,
    versionLabel: undefined,
    pinnedCurrent: false,
    listed: true,
    firstSeenAt,
    ...extra,
  }
}

function statuses(members: PreviewMember[]) {
  return Object.fromEntries(
    Array.from(previewFamily(members), ([mapId, place]) => [mapId, place.status]),
  )
}

describe('client/maps/family-preview', () => {
  test('parses version labels like the server', () => {
    expect(parseVersionKey('1.3')).toEqual({ major: 1.3, minor: 0, patch: 0, suffix: '' })
    expect(parseVersionKey('2.0.1b')).toEqual({ major: 2, minor: 0, patch: 1, suffix: 'b' })
    expect(parseVersionKey('.95')).toEqual({ major: 0.95, minor: 0, patch: 0, suffix: '' })
    expect(parseVersionKey('SE 2.0')).toBeUndefined()
  })

  test('makes the deepest listed version latest, superseding the ones before it', () => {
    expect(
      statuses([
        member(A, 1),
        member(B, 2, A),
        member(C, 3, B),
        member(D, 4, C, MapFamilyRelation.Version, { listed: false }),
        member(E, 5, B, MapFamilyRelation.Variant),
      ]),
    ).toEqual({
      [A]: MapVersionStatus.Superseded,
      [B]: MapVersionStatus.Superseded,
      [C]: MapVersionStatus.Current,
      [D]: MapVersionStatus.None,
      [E]: MapVersionStatus.Variant,
    })
  })

  test('orders versions at the same depth by label, then first seen', () => {
    const result = statuses([
      member(A, 1),
      member(B, 3, A, MapFamilyRelation.Version, { versionLabel: '1.10' }),
      member(C, 2, A, MapFamilyRelation.Version, { versionLabel: '1.9' }),
    ])
    expect(result[B]).toBe(MapVersionStatus.None)
    expect(result[C]).toBe(MapVersionStatus.Current)
  })

  test('honors a pin and gives each fork its own latest', () => {
    const result = statuses([
      member(A, 1, undefined, MapFamilyRelation.Root, { pinnedCurrent: true }),
      member(B, 2, A),
      member(C, 3, A, MapFamilyRelation.Fork),
      member(D, 4, C),
    ])
    expect(result).toEqual({
      [A]: MapVersionStatus.Current,
      [B]: MapVersionStatus.None,
      [C]: MapVersionStatus.Superseded,
      [D]: MapVersionStatus.Current,
    })
  })

  test('lets a listed copy stand in for an unlisted version', () => {
    const result = statuses([
      member(A, 1, undefined, MapFamilyRelation.Root, { listed: false }),
      member(B, 2, A, MapFamilyRelation.Variant),
    ])
    expect(result[B]).toBe(MapVersionStatus.Current)
  })
})
