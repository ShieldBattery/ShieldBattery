import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeMapCollectionId, makeMapFamilyId } from '../../../common/maps'
import { makeSbUserId } from '../../../common/users/sb-user-id'

/* eslint-disable eslint-core/camelcase */

const { query } = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('../db/transaction', () => ({
  default: async (next: (client: unknown) => Promise<unknown>) => await next({ query }),
}))

import { claimMapFeatureNotifications } from './map-feature-models'

const WEEK = new Date('2026-11-09T00:00:00.000Z')
const NOW = new Date('2026-11-11T12:00:00.000Z')
const FAMILY_ID = '11111111-2222-3333-4444-555555555555'
const COLLECTION_ID = '66666666-7777-8888-9999-000000000000'

function row(fields: Record<string, unknown>) {
  return {
    week: WEEK,
    family_id: null,
    collection_id: null,
    name: null,
    user_id: null,
    already_told: false,
    ...fields,
  }
}

/** Makes the claiming statement return `rows`, after the statement taking the lock. */
function claimReturns(rows: unknown[]) {
  query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows })
}

describe('server/lib/maps/map-feature-models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns a notification for each slot of the week holding another pick', async () => {
    claimReturns([
      row({ kind: 'melee', family_id: FAMILY_ID, name: 'Polypoid', user_id: 7 }),
      row({ kind: 'ums', collection_id: COLLECTION_ID, name: 'UMS night', user_id: 8 }),
    ])

    expect(await claimMapFeatureNotifications(NOW)).toEqual([
      {
        week: WEEK,
        kinds: ['melee'],
        pick: { kind: 'map', id: makeMapFamilyId(FAMILY_ID), name: 'Polypoid' },
        userId: makeSbUserId(7),
      },
      {
        week: WEEK,
        kinds: ['ums'],
        pick: { kind: 'collection', id: makeMapCollectionId(COLLECTION_ID), name: 'UMS night' },
        userId: makeSbUserId(8),
      },
    ])
  })

  test('makes one notification of a collection claimed for both slots at once', async () => {
    claimReturns([
      row({ kind: 'melee', collection_id: COLLECTION_ID, name: 'UMS night', user_id: 8 }),
      row({ kind: 'ums', collection_id: COLLECTION_ID, name: 'UMS night', user_id: 8 }),
    ])

    expect(await claimMapFeatureNotifications(NOW)).toEqual([
      {
        week: WEEK,
        kinds: ['melee', 'ums'],
        pick: { kind: 'collection', id: makeMapCollectionId(COLLECTION_ID), name: 'UMS night' },
        userId: makeSbUserId(8),
      },
    ])
  })

  test('leaves out a slot whose collection the other slot already announced', async () => {
    claimReturns([
      row({
        kind: 'ums',
        collection_id: COLLECTION_ID,
        name: 'UMS night',
        user_id: 8,
        already_told: true,
      }),
    ])

    expect(await claimMapFeatureNotifications(NOW)).toEqual([])
  })

  test('keeps a pick with nobody to tell, without a user', async () => {
    claimReturns([row({ kind: 'ums', family_id: FAMILY_ID, name: 'Polypoid' })])

    expect(await claimMapFeatureNotifications(NOW)).toEqual([
      {
        week: WEEK,
        kinds: ['ums'],
        pick: { kind: 'map', id: makeMapFamilyId(FAMILY_ID), name: 'Polypoid' },
        userId: undefined,
      },
    ])
  })
})
