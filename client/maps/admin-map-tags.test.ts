import { describe, expect, test } from 'vitest'
import { MapKind, MapTagAutoRule } from '../gql/graphql'
import { movedTagOrder, orderedTags, takenAutoRules } from './admin-map-tags'

const TAGS = [
  { id: 'standard', kind: MapKind.Melee },
  { id: 'defense', kind: MapKind.Ums },
  { id: 'money', kind: MapKind.Melee },
  { id: 'bound', kind: MapKind.Ums },
  { id: 'island', kind: MapKind.Melee },
]

describe('client/maps/admin-map-tags', () => {
  test("swaps a tag with the next one of its kind, giving that kind's order", () => {
    expect(movedTagOrder(TAGS, 'money', 1)).toEqual({
      kind: MapKind.Melee,
      ids: ['standard', 'island', 'money'],
    })
    expect(movedTagOrder(TAGS, 'money', -1)).toEqual({
      kind: MapKind.Melee,
      ids: ['money', 'standard', 'island'],
    })
    expect(movedTagOrder(TAGS, 'bound', -1)).toEqual({
      kind: MapKind.Ums,
      ids: ['bound', 'defense'],
    })
  })

  test("doesn't move a tag past the ends of its kind", () => {
    expect(movedTagOrder(TAGS, 'standard', -1)).toBeUndefined()
    expect(movedTagOrder(TAGS, 'island', 1)).toBeUndefined()
    expect(movedTagOrder(TAGS, 'bound', 1)).toBeUndefined()
    expect(movedTagOrder(TAGS, 'zombies', 1)).toBeUndefined()
  })

  test('shows the tags in the order being saved', () => {
    expect(orderedTags(TAGS, undefined)).toEqual(TAGS)
    expect(
      orderedTags(TAGS, ['island', 'bound', 'money', 'defense', 'standard']).map(tag => tag.id),
    ).toEqual(['island', 'bound', 'money', 'defense', 'standard'])
    // A tag added meanwhile goes after the ones the order names
    expect(orderedTags(TAGS, ['money', 'standard']).map(tag => tag.id)).toEqual([
      'money',
      'standard',
      'defense',
      'bound',
      'island',
    ])
  })

  test("keeps the other kind's order when one kind's order is being saved", () => {
    const moved = movedTagOrder(TAGS, 'island', -1)!
    const shown = orderedTags(TAGS, moved.ids)
    expect(shown.filter(tag => tag.kind === MapKind.Melee).map(tag => tag.id)).toEqual([
      'standard',
      'island',
      'money',
    ])
    expect(shown.filter(tag => tag.kind === MapKind.Ums).map(tag => tag.id)).toEqual([
      'defense',
      'bound',
    ])
  })

  test('names the tag holding each rule, leaving out the tag being edited', () => {
    const tags = [
      { id: 'standard', name: 'Standard', autoRule: MapTagAutoRule.LadderPool },
      { id: 'money', name: 'Money', autoRule: MapTagAutoRule.RichMinerals },
      { id: 'island', name: 'Island', autoRule: null },
    ]
    expect(takenAutoRules(tags, undefined)).toEqual({
      [MapTagAutoRule.LadderPool]: 'Standard',
      [MapTagAutoRule.RichMinerals]: 'Money',
    })
    expect(takenAutoRules(tags, 'money')).toEqual({ [MapTagAutoRule.LadderPool]: 'Standard' })
    expect(takenAutoRules(tags, 'island')).toEqual({
      [MapTagAutoRule.LadderPool]: 'Standard',
      [MapTagAutoRule.RichMinerals]: 'Money',
    })
    expect(takenAutoRules([], undefined)).toEqual({})
  })
})
