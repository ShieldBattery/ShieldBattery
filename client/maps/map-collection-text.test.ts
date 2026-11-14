import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { MatchmakingType } from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { MapCollectionKind } from '../gql/graphql'
import {
  collectionErrorText,
  collectionSearchArg,
  collectionSubtitle,
  CollectionTextSource,
  collectionTitle,
  collectionTitleMatches,
  dateNeedsYear,
  isValidCollectionTitle,
  poolDatesText,
} from './map-collection-text'

/**
 * Returns each string's default text (its `_one` form for a count of 1) with its `{{placeholders}}`
 * filled in.
 */
const t = ((_key: string, defaultOrOptions: unknown, maybeOptions?: Record<string, unknown>) => {
  const options = (
    typeof defaultOrOptions === 'object' ? defaultOrOptions : (maybeOptions ?? {})
  ) as Record<string, unknown>
  let text = typeof defaultOrOptions === 'string' ? defaultOrOptions : String(options.defaultValue)
  if (options.count === 1 && typeof options.defaultValue_one === 'string') {
    text = options.defaultValue_one
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options[name] ?? ''))
}) as unknown as TFunction

const VIEWER = makeSbUserId(1)
const OTHER = makeSbUserId(2)

/** Formats a date as its ISO day, so tests don't depend on the locale. */
const formatDate = (date: Date) => date.toISOString().slice(0, 10)

function collection(overrides: Partial<CollectionTextSource>): CollectionTextSource {
  return {
    kind: MapCollectionKind.User,
    title: 'UMS with the boys',
    public: false,
    mapCount: 12,
    owner: { id: VIEWER, name: 'grim_reaver' },
    pool: null,
    ...overrides,
  }
}

describe('maps/map-collection-text', () => {
  test('names Starred and ladder pools, and uses the title of the others', () => {
    expect(collectionTitle(collection({ kind: MapCollectionKind.Starred, title: null }), t)).toBe(
      'Starred',
    )
    expect(
      collectionTitle(
        collection({
          kind: MapCollectionKind.LadderPool,
          title: null,
          owner: null,
          pool: { matchmakingType: MatchmakingType.Match1v1, startDate: '2026-10-12T00:00:00Z' },
        }),
        t,
      ),
    ).toBe('1v1 ladder pool')
    expect(collectionTitle(collection({}), t)).toBe('UMS with the boys')
  })

  test("says whether the viewer's own collection is public", () => {
    expect(collectionSubtitle(collection({}), VIEWER, formatDate, t)).toBe('Private · 12 maps')
    expect(collectionSubtitle(collection({ public: true }), VIEWER, formatDate, t)).toBe(
      'Public · 12 maps',
    )
  })

  test("names the owner of someone else's collection", () => {
    expect(
      collectionSubtitle(
        collection({ public: true, mapCount: 4, owner: { id: OTHER, name: 'Bisu' } }),
        VIEWER,
        formatDate,
        t,
      ),
    ).toBe('by Bisu · 4 maps')
    expect(
      collectionSubtitle(collection({ public: true, mapCount: 1 }), undefined, formatDate, t),
    ).toBe('by grim_reaver · 1 map')
  })

  test('counts Starred and credits staff collections to SB staff', () => {
    expect(
      collectionSubtitle(
        collection({ kind: MapCollectionKind.Starred, title: null, mapCount: 7 }),
        VIEWER,
        formatDate,
        t,
      ),
    ).toBe('7 maps')
    expect(
      collectionSubtitle(
        collection({ kind: MapCollectionKind.Staff, owner: null, public: true, mapCount: 8 }),
        VIEWER,
        formatDate,
        t,
      ),
    ).toBe('by SB staff · 8 maps')
  })

  test('dates ladder pools', () => {
    const pool = {
      matchmakingType: MatchmakingType.Match1v1,
      startDate: '2026-10-12T00:00:00Z',
      endDate: null,
    }
    expect(
      collectionSubtitle(
        collection({ kind: MapCollectionKind.LadderPool, owner: null, mapCount: 7, pool }),
        VIEWER,
        formatDate,
        t,
      ),
    ).toBe('Since 2026-10-12 · 7 maps')
    expect(poolDatesText({ ...pool, endDate: '2026-11-03T00:00:00Z' }, formatDate, t)).toBe(
      '2026-10-12 to 2026-11-03',
    )
  })

  test('adds the year only to dates outside the current year', () => {
    const now = new Date(2026, 10, 12)
    expect(dateNeedsYear(new Date(2026, 0, 1), now)).toBe(false)
    expect(dateNeedsYear(new Date(2025, 11, 31), now)).toBe(true)
  })

  test('matches titles ignoring case, spaces and punctuation', () => {
    expect(collectionTitleMatches('UMS-Night starters', 'ums night')).toBe(true)
    expect(collectionTitleMatches('Starred', 'STAR')).toBe(true)
    expect(collectionTitleMatches('Starred', 'pool')).toBe(false)
    expect(collectionTitleMatches('Anything', '  ')).toBe(true)
  })

  test('sends searches the server takes', () => {
    expect(collectionSearchArg('  ')).toBeUndefined()
    expect(collectionSearchArg(' ums ')).toBe('ums')
    expect(collectionSearchArg('a'.repeat(250))).toBe('a'.repeat(200))
    expect([...collectionSearchArg('라'.repeat(250))!].length).toBe(200)
  })

  test('checks titles the way the server does', () => {
    expect(isValidCollectionTitle('  ab  ')).toBe(false)
    expect(isValidCollectionTitle('abc')).toBe(true)
    expect(isValidCollectionTitle('a'.repeat(51))).toBe(false)
    expect(isValidCollectionTitle('two\nlines')).toBe(false)
  })

  test('tells the user why a change failed', () => {
    expect(collectionErrorText('DUPLICATE_TITLE', 'create', t)).toBe(
      'You already have a collection with that title.',
    )
    expect(collectionErrorText('INVALID_TITLE', 'edit', t)).toBe(
      'The title must be 3 to 50 characters on one line.',
    )
    expect(collectionErrorText('COLLECTION_FULL', 'add', t)).toBe(
      'A collection can hold at most 200 maps.',
    )
    expect(collectionErrorText('RESTRICTED', 'report', t)).toBe(
      'You are currently restricted from reporting.',
    )
    expect(collectionErrorText('RESTRICTED', 'publish', t)).toBe(
      "You're restricted from publishing maps, so you can't make collections public.",
    )
    expect(collectionErrorText('RATE_LIMITED', 'report', t)).toBe(
      "You've sent too many reports recently. Please try again later.",
    )
    expect(collectionErrorText('NOT_FOUND', 'remove', t)).toBe(
      "This map or collection doesn't exist anymore.",
    )
    expect(collectionErrorText('NOT_FOUND', 'move', t)).toBe(
      "This map or collection doesn't exist anymore.",
    )
    expect(collectionErrorText('NOT_FOUND', 'edit', t)).toBe(
      "This collection doesn't exist anymore.",
    )
    expect(collectionErrorText(undefined, 'save', t)).toBe(
      'Something went wrong. Please try again later.',
    )
  })
})
