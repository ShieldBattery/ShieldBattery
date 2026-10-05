import { describe, expect, test } from 'vitest'
import { rankByQuery } from './rank-by-query'

describe('messaging/rank-by-query', () => {
  const items = [
    { names: ['banana'] },
    { names: ['abandon'] },
    { names: ['ban'] },
    { names: ['bandana'] },
    { names: ['nothing'] },
  ]
  const getNames = (item: { names: string[] }) => item.names

  test('exact beats prefix beats fuzzy, each in the order given', () => {
    expect(rankByQuery(items, getNames, 'ban').map(i => i.names[0])).toEqual([
      'ban',
      'banana',
      'bandana',
      'abandon',
    ])
  })

  test('substring matches come after prefix matches and before fuzzy ones', () => {
    const withSubstring = [
      { names: ['bxaxn'] },
      { names: ['urban'] },
      { names: ['bandit'] },
      { names: ['ban'] },
    ]

    expect(rankByQuery(withSubstring, getNames, 'ban').map(i => i.names[0])).toEqual([
      'ban',
      'bandit',
      'urban',
      'bxaxn',
    ])
  })

  test('matching ignores case', () => {
    expect(rankByQuery(items, getNames, 'BAN')[0].names[0]).toBe('ban')
  })

  test('any of an item names can be the one that matches', () => {
    const withAliases = [{ names: ['join', 'j', 'channel'] }, { names: ['jump'] }]

    expect(rankByQuery(withAliases, getNames, 'j').map(i => i.names[0])).toEqual(['join', 'jump'])
  })

  test('an empty query keeps everything in the order given', () => {
    expect(rankByQuery(items, getNames, '')).toEqual(items)
  })

  test('items that match nothing are left out', () => {
    expect(rankByQuery(items, getNames, 'zzzz')).toEqual([])
  })
})
