import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { MapKind, MapLens, MapPublishAnswerKind } from '../gql/graphql'
import { publishErrorText } from './map-publish'
import {
  applyFilterChanges,
  mapTagLabel,
  normalizeFilterTags,
  parseTagsParam,
  publishTagsToSend,
  sameTags,
  serializeTagsParam,
  tagChipStates,
  tagEditErrorText,
  tagFilterGroups,
  tagFilterLabel,
  tagIdForName,
  tagsForLens,
  toggleMapTag,
} from './map-tags'

/** Returns each string's default text with its `{{placeholders}}` filled in. */
const t = ((_key: string, defaultValue: string, options?: Record<string, unknown>) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? ''),
  )) as unknown as TFunction

/** A tag of the server's list with only an English name. */
const tag = (id: string, kind: MapKind, name: string, mapCount: number) => ({
  id,
  kind,
  name,
  names: [],
  mapCount,
})

const TAG_LIST = [
  tag('standard', MapKind.Melee, 'Standard', 10),
  tag('money', MapKind.Melee, 'Money', 0),
  tag('island', MapKind.Melee, 'Island', 2),
  tag('team', MapKind.Melee, 'Team', 4),
  tag('defense', MapKind.Ums, 'Defense', 5),
  tag('bound', MapKind.Ums, 'Bound', 0),
  tag('co-op', MapKind.Ums, 'Co-op', 1),
  tag('micro', MapKind.Ums, 'Micro', 3),
]

describe('client/maps/map-tags', () => {
  test('labels a tag by its name in the language, else its English name', () => {
    const coOp = {
      name: 'Co-op',
      names: [
        { locale: 'es', name: 'Cooperativo' },
        { locale: 'zh-Hans', name: '合作' },
      ],
    }
    expect(mapTagLabel(coOp, 'es')).toBe('Cooperativo')
    expect(mapTagLabel(coOp, 'zh-Hans')).toBe('合作')
    expect(mapTagLabel(coOp, 'ko')).toBe('Co-op')
    expect(mapTagLabel(coOp, 'en')).toBe('Co-op')
    expect(mapTagLabel({ name: 'Bound', names: [] }, 'es')).toBe('Bound')
  })

  test('makes the id the server gives a tag of a name', () => {
    expect(tagIdForName('Defense')).toBe('defense')
    expect(tagIdForName('Cat and Mouse')).toBe('cat-and-mouse')
    expect(tagIdForName('  Co-op!  ')).toBe('co-op')
    expect(tagIdForName('--Tug   of__War--')).toBe('tug-of-war')
    expect(tagIdForName('RPG 2')).toBe('rpg-2')
    expect(tagIdForName('Défense')).toBe('d-fense')
    expect(tagIdForName('방어')).toBe('')
    expect(tagIdForName('!!!')).toBe('')
    expect(tagIdForName('a'.repeat(40))).toBe('a'.repeat(32))
    // A cut landing after a dash doesn't leave it at the end
    expect(tagIdForName(`${'a'.repeat(31)} b`)).toBe('a'.repeat(31))
  })

  test('parses the tags param in list order, without repeats or empty parts', () => {
    expect(parseTagsParam(null, TAG_LIST)).toEqual([])
    expect(parseTagsParam('', TAG_LIST)).toEqual([])
    expect(parseTagsParam('co-op,defense', TAG_LIST)).toEqual(['defense', 'co-op'])
    expect(parseTagsParam('defense,,co-op,defense, ', TAG_LIST)).toEqual(['defense', 'co-op'])
    expect(parseTagsParam(' money ,standard', TAG_LIST)).toEqual(['standard', 'money'])
  })

  test('drops ids the tag list does not have', () => {
    expect(parseTagsParam('zombies,defense,hero-siege', TAG_LIST)).toEqual(['defense'])
    expect(parseTagsParam('Defense,hero-siege', TAG_LIST)).toEqual([])
    expect(normalizeFilterTags(['co-op', 'zombies'], TAG_LIST)).toEqual(['co-op'])
  })

  test('keeps the ids in their order until the tag list is loaded', () => {
    expect(parseTagsParam('zombies,defense,,zombies, standard', undefined)).toEqual([
      'zombies',
      'defense',
      'standard',
    ])
    expect(normalizeFilterTags(['a', 'b', 'c', 'd', 'e', 'f'], undefined)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
  })

  test('keeps at most 5 tags', () => {
    expect(parseTagsParam('micro,co-op,bound,defense,team,island,money', TAG_LIST)).toEqual([
      'money',
      'island',
      'team',
      'defense',
      'bound',
    ])
    expect(
      normalizeFilterTags(
        ['x', 'team', 'island', 'money', 'standard', 'defense', 'bound'],
        TAG_LIST,
      ),
    ).toEqual(['standard', 'money', 'island', 'team', 'defense'])
  })

  test('serializes the tags param in the order given, without repeats', () => {
    expect(serializeTagsParam([])).toBe('')
    expect(serializeTagsParam(['co-op', 'defense', 'co-op'])).toBe('co-op,defense')
    expect(parseTagsParam(serializeTagsParam(['island', 'standard']), TAG_LIST)).toEqual([
      'standard',
      'island',
    ])
  })

  test("drops the other kind's tags on a lens change", () => {
    const tags = ['standard', 'defense', 'co-op']
    expect(tagsForLens(tags, MapLens.Melee, TAG_LIST)).toEqual(['standard'])
    expect(tagsForLens(tags, MapLens.Ums, TAG_LIST)).toEqual(['defense', 'co-op'])
    expect(tagsForLens(tags, MapLens.All, TAG_LIST)).toEqual(tags)
    expect(tagsForLens(['defense', 'zombies'], MapLens.Ums, TAG_LIST)).toEqual(['defense'])
    // Without the list, the kinds aren't known
    expect(tagsForLens(tags, MapLens.Melee, undefined)).toEqual(tags)
  })

  describe('applyFilterChanges', () => {
    const params = { lens: MapLens.Ums, tags: ['defense', 'co-op'], players: 2 }

    test('drops the other kind of tags when only the lens changes', () => {
      expect(applyFilterChanges(params, { lens: MapLens.Melee }, TAG_LIST)).toEqual({
        lens: MapLens.Melee,
        tags: [],
        players: 2,
      })
    })

    test('keeps explicit tags given with a lens change', () => {
      expect(
        applyFilterChanges(params, { lens: MapLens.Melee, tags: ['standard'] }, TAG_LIST).tags,
      ).toEqual(['standard'])
    })

    test('leaves tags alone when the lens does not change', () => {
      const result = applyFilterChanges(params, { players: 4 }, TAG_LIST)
      expect(result).toEqual({ ...params, players: 4 })
    })

    test('keeps every tag without a tag list', () => {
      expect(applyFilterChanges(params, { lens: MapLens.Melee }, undefined).tags).toEqual(
        params.tags,
      )
    })
  })

  test('labels the filter chip', () => {
    expect(tagFilterLabel([], TAG_LIST, 'en', t)).toBe('Tags')
    expect(tagFilterLabel(['defense'], TAG_LIST, 'en', t)).toBe('Defense')
    expect(tagFilterLabel(['defense', 'co-op'], TAG_LIST, 'en', t)).toBe('Defense +1')
    expect(tagFilterLabel(['defense', 'co-op', 'bound'], TAG_LIST, 'en', t)).toBe('Defense +2')
    const translated = [{ ...TAG_LIST[4], names: [{ locale: 'es', name: 'Defensa' }] }]
    expect(tagFilterLabel(['defense'], translated, 'es', t)).toBe('Defensa')
    // Until the list is loaded, or for tags it doesn't have, there's no name to show
    expect(tagFilterLabel(['defense'], undefined, 'en', t)).toBe('Tags')
    expect(tagFilterLabel(['zombies'], TAG_LIST, 'en', t)).toBe('Tags')
  })

  test("offers the lens's tags that maps have, plus the selected ones", () => {
    const ids = (groups: ReadonlyArray<ReadonlyArray<{ id: string }>>) =>
      groups.map(group => group.map(tag => tag.id))
    expect(ids(tagFilterGroups(TAG_LIST, MapLens.All, []))).toEqual([
      ['standard', 'island', 'team'],
      ['defense', 'co-op', 'micro'],
    ])
    expect(ids(tagFilterGroups(TAG_LIST, MapLens.Melee, []))).toEqual([
      ['standard', 'island', 'team'],
    ])
    expect(ids(tagFilterGroups(TAG_LIST, MapLens.Ums, ['bound']))).toEqual([
      ['defense', 'bound', 'co-op', 'micro'],
    ])
    // A selected tag of the other kind still shows, to be unpicked
    expect(ids(tagFilterGroups(TAG_LIST, MapLens.Melee, ['defense']))).toEqual([
      ['standard', 'island', 'team'],
      ['defense'],
    ])
    expect(tagFilterGroups([], MapLens.All, [])).toEqual([])
  })

  test('lets the dialog chips pick at most 3 tags', () => {
    const options = ['defense', 'bound', 'co-op', 'micro']
    expect(tagChipStates(options, [])).toEqual([
      { id: 'defense', selected: false, disabled: false, locked: false },
      { id: 'bound', selected: false, disabled: false, locked: false },
      { id: 'co-op', selected: false, disabled: false, locked: false },
      { id: 'micro', selected: false, disabled: false, locked: false },
    ])
    expect(tagChipStates(options, ['defense', 'bound', 'co-op'])).toEqual([
      { id: 'defense', selected: true, disabled: false, locked: false },
      { id: 'bound', selected: true, disabled: false, locked: false },
      { id: 'co-op', selected: true, disabled: false, locked: false },
      { id: 'micro', selected: false, disabled: true, locked: false },
    ])
  })

  test('keeps locked tags selected and unchangeable', () => {
    const options = ['defense', 'bound', 'co-op']
    expect(tagChipStates(options, ['bound'], ['bound'])).toEqual([
      { id: 'defense', selected: false, disabled: false, locked: false },
      { id: 'bound', selected: true, disabled: true, locked: true },
      { id: 'co-op', selected: false, disabled: false, locked: false },
    ])
    expect(toggleMapTag(options, ['bound'], 'bound', ['bound'])).toEqual(['bound'])
  })

  test('toggles tags in list order, up to 3', () => {
    const options = ['defense', 'bound', 'co-op', 'micro']
    expect(toggleMapTag(options, ['co-op'], 'defense')).toEqual(['defense', 'co-op'])
    expect(toggleMapTag(options, ['defense', 'co-op'], 'defense')).toEqual(['co-op'])
    expect(toggleMapTag(options, ['defense', 'bound', 'co-op'], 'micro')).toEqual([
      'defense',
      'bound',
      'co-op',
    ])
  })

  test('compares tag sets in any order', () => {
    expect(sameTags(['defense', 'co-op'], ['co-op', 'defense'])).toBe(true)
    expect(sameTags(['defense'], ['defense', 'co-op'])).toBe(false)
    expect(sameTags([], [])).toBe(true)
  })

  test('sends tags at publish only when they changed, and never with JOIN', () => {
    expect(publishTagsToSend(MapPublishAnswerKind.Keep, [], [])).toBeNull()
    expect(publishTagsToSend(MapPublishAnswerKind.Keep, ['standard'], ['standard'])).toBeNull()
    expect(publishTagsToSend(MapPublishAnswerKind.Keep, [], ['standard', 'island'])).toEqual([
      'standard',
      'island',
    ])
    expect(publishTagsToSend(MapPublishAnswerKind.Unsure, ['standard'], [])).toEqual([])
    expect(publishTagsToSend(MapPublishAnswerKind.Join, [], ['standard'])).toBeNull()
  })

  test('says why a change of tags failed', () => {
    expect(tagEditErrorText('TAG_LOCKED', t)).toBe(
      "One of the tags you removed was set by staff or the map's maker, so it stays.",
    )
    expect(tagEditErrorText('FORBIDDEN', t)).toBe('This map has a maker now, who sets its tags.')
    expect(tagEditErrorText('RATE_LIMITED', t)).toBe(
      "You've changed a lot of map tags in the last hour. Try again later.",
    )
    expect(tagEditErrorText('NOT_FOUND', t)).toBe('This map could not be found.')
    expect(tagEditErrorText(undefined, t)).toBe("Couldn't save the tags. Please try again later.")
    const codes = [
      'BAD_REQUEST',
      'FORBIDDEN',
      'NOT_LISTED',
      'EMAIL_UNVERIFIED',
      'RESTRICTED',
      'TAG_LOCKED',
      'RATE_LIMITED',
      'NOT_FOUND',
    ]
    expect(new Set(codes.map(code => tagEditErrorText(code, t))).size).toBe(codes.length)
  })

  test('says why a publish with tags failed', () => {
    expect(publishErrorText('TAG_LOCKED', t)).toBe(
      'This map has a tag set by staff or its maker that your tags would remove.',
    )
    expect(publishErrorText('BAD_REQUEST', t, true)).toBe("These tags can't be used on this map.")
    expect(publishErrorText('FORBIDDEN', t, true)).toBe(
      "Someone else is this map's maker, who sets its tags.",
    )
    // Without tags, those codes are about something else
    expect(publishErrorText('BAD_REQUEST', t)).toBe('Something went wrong. Please try again later.')
    expect(publishErrorText('FORBIDDEN', t)).toBe('Something went wrong. Please try again later.')
  })
})
