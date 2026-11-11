import { describe, expect, test } from 'vitest'
import { makeSbMapId } from '../../common/maps'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { MapOwnerClaimBlockedReason } from '../gql/graphql'
import { claimMenuState, mapReportOptions, pickOrOnlyChoice } from './map-owner'

const VIEWER = makeSbUserId(1)
const OTHER = makeSbUserId(2)
const A = makeSbMapId('00000000-0000-4000-8000-00000000000a')
const B = makeSbMapId('00000000-0000-4000-8000-00000000000b')
const C = makeSbMapId('00000000-0000-4000-8000-00000000000c')

describe('client/maps/map-owner', () => {
  describe('claimMenuState', () => {
    const preview = (
      blockedReason: MapOwnerClaimBlockedReason | null,
      { instant = false, hasOpenClaim = false } = {},
    ) => ({ blockedReason, instant, hasOpenClaim })

    test('offers the owner to give the map up', () => {
      expect(claimMenuState(true, preview(MapOwnerClaimBlockedReason.AlreadyOwner))).toEqual({
        kind: 'relinquish',
      })
      expect(claimMenuState(true, undefined)).toEqual({ kind: 'relinquish' })
    })

    test('hides the item until the preview loads, and for reasons a retry never fixes', () => {
      expect(claimMenuState(false, undefined)).toEqual({ kind: 'hidden' })
      for (const reason of [
        MapOwnerClaimBlockedReason.Restricted,
        MapOwnerClaimBlockedReason.NotListed,
        MapOwnerClaimBlockedReason.AlreadyOwner,
      ]) {
        expect(claimMenuState(false, preview(reason, { hasOpenClaim: true }))).toEqual({
          kind: 'hidden',
        })
      }
    })

    test('shows a claim waiting for staff over a reason to wait', () => {
      expect(claimMenuState(false, preview(null, { hasOpenClaim: true }))).toEqual({
        kind: 'pending',
      })
      expect(
        claimMenuState(
          false,
          preview(MapOwnerClaimBlockedReason.RateLimited, { hasOpenClaim: true }),
        ),
      ).toEqual({ kind: 'pending' })
    })

    test('offers an instant claim even with an open claim, unless the viewer is blocked', () => {
      expect(claimMenuState(false, preview(null, { instant: true, hasOpenClaim: true }))).toEqual({
        kind: 'claim',
        instant: true,
      })
      expect(claimMenuState(false, preview(null, { instant: false, hasOpenClaim: true }))).toEqual({
        kind: 'pending',
      })
      expect(
        claimMenuState(
          false,
          preview(MapOwnerClaimBlockedReason.RateLimited, { instant: true, hasOpenClaim: true }),
        ),
      ).toEqual({ kind: 'pending' })
    })

    test('says why a claim has to wait', () => {
      expect(claimMenuState(false, preview(MapOwnerClaimBlockedReason.EmailUnverified))).toEqual({
        kind: 'blocked',
        reason: MapOwnerClaimBlockedReason.EmailUnverified,
      })
      expect(claimMenuState(false, preview(MapOwnerClaimBlockedReason.RateLimited))).toEqual({
        kind: 'blocked',
        reason: MapOwnerClaimBlockedReason.RateLimited,
      })
    })

    test('offers a claim, instant or for staff', () => {
      expect(claimMenuState(false, preview(null, { instant: true }))).toEqual({
        kind: 'claim',
        instant: true,
      })
      expect(claimMenuState(false, preview(null))).toEqual({ kind: 'claim', instant: false })
    })
  })

  describe('mapReportOptions', () => {
    const files = (...listed: boolean[]) =>
      [A, B, C].slice(0, listed.length).map((id, i) => ({ id, listed: listed[i] }))

    test('offers only the map-level reports until the map loads', () => {
      expect(mapReportOptions({ fileCount: 1 })).toEqual({ options: ['sameMap'] })
      expect(mapReportOptions({ fileCount: 2 })).toEqual({ options: ['wrongMap', 'sameMap'] })
    })

    test('offers a better default for a map nobody owns with two listed files', () => {
      const family = { currentId: A, files: files(true, true) }
      expect(mapReportOptions({ fileCount: 2, family, contextFileId: B })).toEqual({
        options: ['wrongMap', 'sameMap', 'wrongDefault', 'inappropriate'],
        wrongDefault: { fixed: B },
        inappropriate: { fixed: B },
      })
      // Viewing the current file, the report asks which file should replace it
      expect(mapReportOptions({ fileCount: 2, family, contextFileId: A })).toMatchObject({
        wrongDefault: { choices: [B] },
        inappropriate: { fixed: A },
      })
    })

    test('offers no better default for an owned map or one listed file', () => {
      expect(
        mapReportOptions({
          fileCount: 2,
          family: { ownerId: OTHER, currentId: A, files: files(true, true) },
          viewerId: VIEWER,
          contextFileId: B,
        }).options,
      ).toEqual(['wrongMap', 'sameMap', 'wrongOwner', 'inappropriate'])
      expect(
        mapReportOptions({
          fileCount: 2,
          family: { currentId: A, files: files(true, false) },
          contextFileId: B,
        }),
      ).toEqual({
        options: ['wrongMap', 'sameMap', 'inappropriate'],
        inappropriate: { choices: [A] },
      })
    })

    test("doesn't let the owner report themselves", () => {
      expect(
        mapReportOptions({
          fileCount: 1,
          family: { ownerId: VIEWER, currentId: A, files: files(true) },
          viewerId: VIEWER,
          contextFileId: A,
        }).options,
      ).toEqual(['sameMap', 'inappropriate'])
    })

    test('offers nothing about files when none is listed', () => {
      expect(
        mapReportOptions({
          fileCount: 1,
          family: { currentId: A, files: files(false) },
          contextFileId: A,
        }),
      ).toEqual({ options: ['sameMap'] })
    })
  })

  describe('pickOrOnlyChoice', () => {
    test('keeps a pick that is still a choice', () => {
      expect(pickOrOnlyChoice([A, B], B)).toBe(B)
    })

    test('picks the only choice when nothing is picked', () => {
      expect(pickOrOnlyChoice([A], undefined)).toBe(A)
    })

    test('picks the only choice when the pick is gone', () => {
      expect(pickOrOnlyChoice([A], B)).toBe(A)
    })

    test('picks nothing among several choices', () => {
      expect(pickOrOnlyChoice([A, B], undefined)).toBeUndefined()
      expect(pickOrOnlyChoice([A, B], C)).toBeUndefined()
    })

    test('picks nothing without choices', () => {
      expect(pickOrOnlyChoice([], undefined)).toBeUndefined()
    })
  })
})
