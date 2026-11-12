import { TFunction } from 'i18next'
import { MatchmakingType, matchmakingTypeToLabel } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { MapCollectionKind } from '../gql/graphql'

/**
 * The longest search for collections the server takes, in characters. Keep in sync with
 * `MAX_SEARCH_LENGTH` on the server (maps/search.rs).
 */
export const MAX_COLLECTION_SEARCH_LENGTH = 200

/**
 * The search for collections to send for `text`: trimmed, cut to the length the server takes, and
 * undefined when there's nothing to search for.
 */
export function collectionSearchArg(text: string): string | undefined {
  const trimmed = [...text.trim()].slice(0, MAX_COLLECTION_SEARCH_LENGTH).join('').trim()
  return trimmed || undefined
}

/** Keep in sync with `MAX_COLLECTION_MAPS` on the server (maps/collections/mod.rs). */
export const MAX_COLLECTION_MAPS = 200
/** Keep in sync with `MIN_TITLE_LENGTH` on the server (maps/collections/mod.rs). */
export const MIN_COLLECTION_TITLE_LENGTH = 3
/** Keep in sync with `MAX_TITLE_LENGTH` on the server (maps/collections/mod.rs). */
export const MAX_COLLECTION_TITLE_LENGTH = 50
/** Keep in sync with `MAX_DESCRIPTION_LENGTH` on the server (maps/collections/mod.rs). */
export const MAX_COLLECTION_DESCRIPTION_LENGTH = 500
/** Keep in sync with `MAX_NOTE_LENGTH` on the server (maps/collections/mod.rs). */
export const MAX_COLLECTION_NOTE_LENGTH = 500

/** Counts code points (not UTF-16 units), to match the server's `chars().count()`. */
export function textLength(text: string): number {
  return [...text].length
}

/** Whether `title` is a title the server accepts, once trimmed. */
export function isValidCollectionTitle(title: string): boolean {
  const trimmed = title.trim()
  const length = textLength(trimmed)
  return (
    length >= MIN_COLLECTION_TITLE_LENGTH &&
    length <= MAX_COLLECTION_TITLE_LENGTH &&
    !/[\r\n]/.test(trimmed)
  )
}

/** What a collection's title and subtitle are made from. */
export interface CollectionTextSource {
  kind: MapCollectionKind
  /** The title its owner or staff gave it. Null for Starred and ladder pools. */
  title?: string | null
  public: boolean
  /** How many maps the viewer sees in it. */
  mapCount: number
  owner?: { id: SbUserId; name: string } | null
  pool?: { matchmakingType: MatchmakingType; startDate: string; endDate?: string | null } | null
}

/** The name a collection goes by: its title, or for Starred and ladder pools, a name for them. */
export function collectionTitle(
  collection: Pick<CollectionTextSource, 'kind' | 'title' | 'pool'>,
  t: TFunction,
): string {
  switch (collection.kind) {
    case MapCollectionKind.Starred:
      return t('maps.collections.starred', 'Starred')
    case MapCollectionKind.LadderPool:
      return collection.pool
        ? t('maps.collections.poolTitle', {
            defaultValue: '{{mode}} ladder pool',
            mode: matchmakingTypeToLabel(collection.pool.matchmakingType, t),
          })
        : t('maps.collections.ladderPool', 'Ladder pool')
    case MapCollectionKind.User:
    case MapCollectionKind.Staff:
      return collection.title ?? ''
    default:
      return collection.kind satisfies never
  }
}

/** How many maps a collection holds, e.g. `7 maps`. */
export function mapCountText(count: number, t: TFunction): string {
  return t('maps.catalog.mapCount', {
    defaultValue: '{{count}} maps',
    defaultValue_one: '{{count}} map',
    count,
  })
}

/**
 * When a ladder pool is played: `Since 12 Oct` for the pool its matchmaking type plays now, else
 * `12 Oct to 3 Nov`. `formatDate` formats each date.
 */
export function poolDatesText(
  pool: { startDate: string; endDate?: string | null },
  formatDate: (date: Date) => string,
  t: TFunction,
): string {
  const start = formatDate(new Date(pool.startDate))
  return pool.endDate
    ? t('maps.collections.poolDateRange', {
        defaultValue: '{{start}} to {{end}}',
        start,
        end: formatDate(new Date(pool.endDate)),
      })
    : t('maps.collections.poolSince', { defaultValue: 'Since {{start}}', start })
}

/**
 * Whether a date shown in a collection's subtitle needs its year: when it isn't in the year it is
 * now, so a date never reads as this year's by mistake.
 */
export function dateNeedsYear(date: Date, now: Date): boolean {
  return date.getFullYear() !== now.getFullYear()
}

/**
 * The line under a collection's title on its card, telling whose it is and how many maps it holds:
 * `7 maps` (Starred), `Private · 12 maps` (the viewer's own), `by grim_reaver · 4 maps` (someone
 * else's), `by SB staff · 8 maps`, or `Since 12 Oct · 7 maps` (a ladder pool).
 */
export function collectionSubtitle(
  collection: CollectionTextSource,
  viewerId: SbUserId | undefined,
  formatDate: (date: Date) => string,
  t: TFunction,
): string {
  const count = mapCountText(collection.mapCount, t)
  switch (collection.kind) {
    case MapCollectionKind.Starred:
      return count
    case MapCollectionKind.User:
      if (viewerId !== undefined && collection.owner?.id === viewerId) {
        return [
          collection.public
            ? t('maps.collections.public', 'Public')
            : t('maps.collections.private', 'Private'),
          count,
        ].join(' · ')
      }
      return collection.owner
        ? [
            t('maps.collections.byOwner', {
              defaultValue: 'by {{name}}',
              name: collection.owner.name,
            }),
            count,
          ].join(' · ')
        : count
    case MapCollectionKind.Staff:
      return [t('maps.collections.bySbStaff', 'by SB staff'), count].join(' · ')
    case MapCollectionKind.LadderPool:
      return collection.pool
        ? [poolDatesText(collection.pool, formatDate, t), count].join(' · ')
        : count
    default:
      return collection.kind satisfies never
  }
}

/**
 * The form of a title that searching for collections compares: lowercased, without spaces and
 * punctuation, so `ums night` finds "UMS-Night".
 */
export function normalizeCollectionSearch(text: string): string {
  return text.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** Whether a collection called `title` matches the search `search` (see the server's search). */
export function collectionTitleMatches(title: string, search: string): boolean {
  const needle = normalizeCollectionSearch(search)
  return !needle || normalizeCollectionSearch(title).includes(needle)
}

/** What a collection change was, for the sentence its failure is told with. */
export type CollectionChange = 'create' | 'edit' | 'publish' | 'delete' | 'add' | 'save' | 'report'

/**
 * What a failed collection change tells the user, given the error code the server sent. `change`
 * picks the sentence for codes that mean different things for different changes.
 */
export function collectionErrorText(code: unknown, change: CollectionChange, t: TFunction): string {
  switch (code) {
    case 'FORBIDDEN':
      return t('maps.collections.errorForbidden', "You can't change this collection.")
    case 'NOT_FOUND':
      return change === 'add'
        ? t('maps.collections.errorMapNotFound', "This map or collection doesn't exist anymore.")
        : t('maps.collections.errorNotFound', "This collection doesn't exist anymore.")
    case 'UNAUTHORIZED':
      return t('maps.collections.errorLoggedOut', 'Log in to do that.')
    case 'INVALID_TITLE':
      return t('maps.collections.errorInvalidTitle', {
        defaultValue: 'The title must be {{min}} to {{max}} characters on one line.',
        min: MIN_COLLECTION_TITLE_LENGTH,
        max: MAX_COLLECTION_TITLE_LENGTH,
      })
    case 'INVALID_DESCRIPTION':
      return t('maps.collections.errorInvalidDescription', {
        defaultValue: 'The description can be at most {{max}} characters.',
        max: MAX_COLLECTION_DESCRIPTION_LENGTH,
      })
    case 'DUPLICATE_TITLE':
      return t(
        'maps.collections.errorDuplicateTitle',
        'You already have a collection with that title.',
      )
    case 'TOO_MANY_COLLECTIONS':
      return t('maps.collections.errorTooManyCollections', {
        defaultValue: 'You can have at most {{max}} collections.',
        max: 100,
      })
    case 'COLLECTION_FULL':
      return t('maps.collections.errorFull', {
        defaultValue: 'A collection can hold at most {{max}} maps.',
        max: MAX_COLLECTION_MAPS,
      })
    case 'EMAIL_UNVERIFIED':
      return t(
        'maps.collections.errorEmailUnverified',
        'Verify your email address to make a collection public.',
      )
    case 'RESTRICTED':
      return change === 'report'
        ? t('maps.report.restricted', 'You are currently restricted from reporting.')
        : t(
            'maps.collections.errorPublishingRestricted',
            "You're restricted from publishing maps, so you can't make collections public.",
          )
    case 'RESTRICTED_NAME':
      return t(
        'maps.collections.errorRestrictedName',
        "The title or description has a word that isn't allowed in public collections.",
      )
    case 'HIDDEN':
      return t(
        'maps.collections.errorHidden',
        "Staff hid this collection, so it can't be made public or private.",
      )
    case 'TOO_MANY_SAVES':
      return t('maps.collections.errorTooManySaves', {
        defaultValue: 'You can save at most {{max}} collections.',
        max: 500,
      })
    case 'RATE_LIMITED':
      return t(
        'maps.report.rateLimited',
        "You've sent too many reports recently. Please try again later.",
      )
    default:
      return t('maps.collections.error', 'Something went wrong. Please try again later.')
  }
}
