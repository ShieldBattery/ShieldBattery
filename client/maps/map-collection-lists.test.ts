import { describe, expect, test } from 'vitest'
import { MapCollectionKind } from '../gql/graphql'
import { addableCollections, inKeptOrder, splitLadderPools } from './map-collection-lists'

function collection(id: string, kind: MapCollectionKind, canEdit = true) {
  return { id, kind, canEdit }
}

describe('client/maps/map-collection-lists', () => {
  test('offers the viewer their own collections and the staff ones they can change', () => {
    const own = [
      collection('starred', MapCollectionKind.Starred),
      collection('mine', MapCollectionKind.User),
      collection('saved', MapCollectionKind.User, false),
      collection('mine2', MapCollectionKind.User),
    ]
    const staff = [
      collection('picks', MapCollectionKind.Staff),
      collection('locked', MapCollectionKind.Staff, false),
    ]
    expect(addableCollections(own, staff)).toEqual({
      own: [own[1], own[3]],
      staff: [staff[0]],
    })
    expect(addableCollections(own, [])).toEqual({ own: [own[1], own[3]], staff: [] })
  })

  test('keeps an order, putting items added since first', () => {
    const items = [{ id: 'c' }, { id: 'new' }, { id: 'a' }, { id: 'b' }]
    expect(inKeptOrder(items, ['a', 'b', 'c']).map(i => i.id)).toEqual(['new', 'a', 'b', 'c'])
    expect(inKeptOrder(items, []).map(i => i.id)).toEqual(['c', 'new', 'a', 'b'])
    expect(inKeptOrder([{ id: 'a' }], ['gone', 'a']).map(i => i.id)).toEqual(['a'])
  })

  test('splits ladder pools into current and past ones', () => {
    const now = { id: '1', pool: { isCurrent: true } }
    const before = { id: '2', pool: { isCurrent: false } }
    const unknown = { id: '3', pool: null }
    expect(splitLadderPools([before, now, unknown])).toEqual({
      current: [now],
      past: [before, unknown],
    })
  })
})
