import { TFunction } from 'i18next'
import { useQuery } from 'urql'
import { graphql } from '../gql'
import { MapKind, MapLens, MapPublishAnswerKind } from '../gql/graphql'

/** The most tags a map holds. */
export const MAX_MAP_TAGS = 3

/** The most tags a listing of maps can be filtered by. */
export const MAX_FILTER_TAGS = 5

/** The names a map tag shows by. */
export interface MapTagNames {
  /** The tag's English name. */
  name: string
  /** The tag's names in other languages. A language without one shows the English name. */
  names: ReadonlyArray<{ locale: string; name: string }>
}

/**
 * The label of a map tag in `language` (an i18next language code): its name in that language, else
 * its English name.
 */
export function mapTagLabel(tag: MapTagNames, language: string): string {
  return tag.names.find(n => n.locale === language)?.name ?? tag.name
}

/** The most characters the id the server makes from a tag's English name has. */
const MAX_TAG_ID_CHARS = 32

/**
 * The id the server makes for a tag created with the English name `name`: lowercase, every run of
 * characters other than `a`-`z` and `0`-`9` turned into one `-`, without `-` at either end, and at
 * most {@link MAX_TAG_ID_CHARS} characters. Empty when the name has none of those characters, which
 * the server refuses. The server adds `-2`, `-3`, ... when another tag has the id already.
 */
export function tagIdForName(name: string): string {
  const slug = name
    .replace(/[A-Z]/g, c => c.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter(part => part.length > 0)
    .join('-')
  return slug.slice(0, MAX_TAG_ID_CHARS).replace(/-+$/, '')
}

/** The lens showing maps of `kind`. */
export function lensForKind(kind: MapKind): MapLens {
  return kind === MapKind.Melee ? MapLens.Melee : MapLens.Ums
}

/** The kind of map `lens` shows, or undefined for every map. */
function kindForLens(lens: MapLens): MapKind | undefined {
  switch (lens) {
    case MapLens.Melee:
      return MapKind.Melee
    case MapLens.Ums:
      return MapKind.Ums
    default:
      return undefined
  }
}

/**
 * The tag ids a listing is filtered by, as a stable list: trimmed, without repeats, and at most
 * {@link MAX_FILTER_TAGS} of them. With the server's `tagList` loaded, ids it doesn't have are
 * dropped (a link to a deleted tag shows the listing without it) and the rest follow its order.
 * Without it, the ids keep their order, and the server ignores the ones it doesn't have.
 */
export function normalizeFilterTags(
  ids: Iterable<string>,
  tagList: ReadonlyArray<{ id: string }> | undefined,
): string[] {
  const unique = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (trimmed) {
      unique.add(trimmed)
    }
  }
  const result = tagList ? tagList.map(tag => tag.id).filter(id => unique.has(id)) : [...unique]
  return result.slice(0, MAX_FILTER_TAGS)
}

/**
 * Reads the catalog's `tags` URL param: comma-separated tag ids, kept as
 * {@link normalizeFilterTags} keeps them with `tagList`.
 */
export function parseTagsParam(
  value: string | null | undefined,
  tagList: ReadonlyArray<{ id: string }> | undefined,
): string[] {
  return value ? normalizeFilterTags(value.split(','), tagList) : []
}

/** Writes tag ids, in their order, as the catalog's `tags` URL param (empty for none). */
export function serializeTagsParam(ids: Iterable<string>): string {
  return normalizeFilterTags(ids, undefined).join(',')
}

/**
 * The tags of `tags` that still apply once the listing shows `lens`: the ones of the other kind of
 * map are dropped, as are ones `tagList` doesn't have. Until `tagList` is loaded the kinds aren't
 * known, so every tag is kept.
 */
export function tagsForLens(
  tags: ReadonlyArray<string>,
  lens: MapLens,
  tagList: ReadonlyArray<{ id: string; kind: MapKind }> | undefined,
): string[] {
  const kind = kindForLens(lens)
  if (!kind || !tagList) {
    return [...tags]
  }
  return tags.filter(id => tagList.some(tag => tag.id === id && tag.kind === kind))
}

/**
 * The label of the catalog's Tags filter: "Tags", the one tag picked, or e.g. "Defense +1". Until
 * `tagList` is loaded the picked tags have no names to show, so it's "Tags".
 */
export function tagFilterLabel(
  selected: ReadonlyArray<string>,
  tagList: ReadonlyArray<{ id: string } & MapTagNames> | undefined,
  language: string,
  t: TFunction,
): string {
  const tags = selected.flatMap(id => tagList?.find(tag => tag.id === id) ?? [])
  if (!tags.length) {
    return t('maps.tags.filter', 'Tags')
  } else if (tags.length === 1) {
    return mapTagLabel(tags[0], language)
  }
  return t('maps.tags.filterMore', '{{tag}} +{{more}}', {
    tag: mapTagLabel(tags[0], language),
    more: tags.length - 1,
  })
}

/** A tag of the server's list. */
export interface TagListEntry extends MapTagNames {
  id: string
  kind: MapKind
  /** How many listed maps have the tag. */
  mapCount: number
}

/**
 * The tags the catalog's Tags filter offers, as groups to show apart: the tags of the maps `lens`
 * shows that at least one listed map has, plus every selected tag. Melee tags come first, then UMS
 * tags. Empty groups are left out.
 */
export function tagFilterGroups<T extends { id: string; kind: MapKind; mapCount: number }>(
  tagList: ReadonlyArray<T>,
  lens: MapLens,
  selected: ReadonlyArray<string>,
): T[][] {
  const lensKind = kindForLens(lens)
  const offered = (kind: MapKind) =>
    tagList.filter(
      tag =>
        tag.kind === kind &&
        (selected.includes(tag.id) || ((!lensKind || lensKind === kind) && tag.mapCount > 0)),
    )
  return [offered(MapKind.Melee), offered(MapKind.Ums)].filter(group => group.length)
}

/** How one tag shows among the toggle chips that pick a map's tags. */
export interface TagChipState {
  id: string
  selected: boolean
  disabled: boolean
  /** Whether the tag is selected and can't be removed by the viewer. */
  locked: boolean
}

/**
 * The toggle chips that pick a map's tags: one per tag of `options`, in that order. A locked tag
 * is selected and can't be toggled. With {@link MAX_MAP_TAGS} selected, the unselected ones can't
 * be picked.
 */
export function tagChipStates(
  options: ReadonlyArray<string>,
  selected: ReadonlyArray<string>,
  locked: ReadonlyArray<string> = [],
): TagChipState[] {
  const full = selected.length >= MAX_MAP_TAGS
  return options.map(id => {
    const isLocked = locked.includes(id)
    const isSelected = isLocked || selected.includes(id)
    return {
      id,
      selected: isSelected,
      disabled: isLocked || (!isSelected && full),
      locked: isLocked,
    }
  })
}

/**
 * The selection after toggling `id`, in the order of `options`. Locked tags stay selected, and
 * nothing is added past {@link MAX_MAP_TAGS}.
 */
export function toggleMapTag(
  options: ReadonlyArray<string>,
  selected: ReadonlyArray<string>,
  id: string,
  locked: ReadonlyArray<string> = [],
): string[] {
  let next: ReadonlyArray<string>
  if (selected.includes(id)) {
    next = locked.includes(id) ? selected : selected.filter(s => s !== id)
  } else {
    next = selected.length >= MAX_MAP_TAGS ? selected : [...selected, id]
  }
  return options.filter(o => next.includes(o))
}

/** Whether two lists hold the same tags, in any order. */
export function sameTags(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every(id => b.includes(id))
}

/**
 * The `tags` to publish a file with: the picked tags when the user changed them from `initial`,
 * else null, which leaves the map's tags alone. A `JOIN` puts the file in another map, so it never
 * sends tags.
 */
export function publishTagsToSend(
  answerKind: MapPublishAnswerKind,
  initial: ReadonlyArray<string>,
  selected: ReadonlyArray<string>,
): string[] | null {
  if (answerKind === MapPublishAnswerKind.Join || sameTags(initial, selected)) {
    return null
  }
  return [...selected]
}

/** What a failed change of a map's tags tells the user, given the error code the server sent. */
export function tagEditErrorText(code: unknown, t: TFunction): string {
  switch (code) {
    case 'BAD_REQUEST':
      return t('maps.tags.badRequest', "These tags can't be used on this map.")
    case 'FORBIDDEN':
      return t('maps.tags.hasMaker', 'This map has a maker now, who sets its tags.')
    case 'NOT_LISTED':
      return t('maps.tags.notListed', "This map isn't published, so its tags can't be changed.")
    case 'EMAIL_UNVERIFIED':
      return t('maps.tags.emailUnverified', 'Verify your email address to change map tags.')
    case 'RESTRICTED':
      return t(
        'maps.tags.restricted',
        "You're restricted from publishing maps, so you can't change map tags.",
      )
    case 'TAG_LOCKED':
      return t(
        'maps.tags.locked',
        "One of the tags you removed was set by staff or the map's maker, so it stays.",
      )
    case 'RATE_LIMITED':
      return t(
        'maps.tags.rateLimited',
        "You've changed a lot of map tags in the last hour. Try again later.",
      )
    case 'NOT_FOUND':
      return t('maps.page.notFound', 'This map could not be found.')
    default:
      return t('maps.tags.error', "Couldn't save the tags. Please try again later.")
  }
}

const MapTagListQuery = graphql(/* GraphQL */ `
  query MapTagList {
    mapTags {
      id
      kind
      name
      names {
        locale
        name
      }
      mapCount
    }
  }
`)

/** Requests results without suspending. Module-level so the query sees the same context. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/** The server's list of map tags, in list order, once it's loaded. */
export function useMapTagList(): ReadonlyArray<TagListEntry> | undefined {
  const [{ data }] = useQuery({ query: MapTagListQuery, context: NO_SUSPENSE_CONTEXT })
  return data?.mapTags
}
