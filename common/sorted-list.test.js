import { create, findIndex, insert } from './sorted-list'

const alphaSort = (a, b) => a.localeCompare(b)

describe('sorted-list', function () {
  describe('create', () => {
    test('should create an empty list', () => {
      const result = create(alphaSort)
      expect(result.size).toBe(0)
    })

    test('should create a filled list', () => {
      const result = create(alphaSort, ['z', 'a', 'b'])
      expect(result.size).toBe(3)
      expect(result.get(0)).toBe('a')
      expect(result.get(1)).toBe('b')
      expect(result.get(2)).toBe('z')
    })
  })

  describe('findIndex', () => {
    test('should find nothing in an empty list', () => {
      const result = findIndex(alphaSort, create(alphaSort), 'a')
      expect(result).toEqual(-1)
    })

    test('should find a single item in a one item list', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['a']), 'a')
      expect(result).toBe(0)
    })

    test('should not find a single item in a non-equal one item list', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['b']), 'a')
      expect(result).toEqual(-1)
    })

    test('should find a single item in a three item list, early item', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['a', 'b', 'c']), 'a')
      expect(result).toBe(0)
    })

    test('should find a single item in a three item list, middle item', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['a', 'b', 'c']), 'b')
      expect(result).toBe(1)
    })

    test('should find a single item in a three item list, late item', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['a', 'b', 'c']), 'c')
      expect(result).toBe(2)
    })

    test('should find a single item in a large list', () => {
      const result = findIndex(
        alphaSort,
        create(alphaSort, ['a', 'a', 'b', 'b', 'c', 'f', 'f', 'j', 'y', 'y', 'y', 'z']),
        'c',
      )
      expect(result).toBe(4)
    })

    test('should not find a single item in a large list, no equal item present', () => {
      const result = findIndex(
        alphaSort,
        create(alphaSort, ['a', 'a', 'b', 'b', 'c', 'f', 'f', 'j', 'y', 'y', 'y', 'z']),
        'g',
      )
      expect(result).toEqual(-1)
    })
  })

  describe('insert', () => {
    test('should insert into an empty list', () => {
      const result = insert(alphaSort, create(alphaSort), 'a')
      expect(result.toJS()).toEqual(['a'])
    })

    test('should insert into a one element list, earlier entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['b']), 'a')
      expect(result.toJS()).toEqual(['a', 'b'])
    })

    test('should insert into a one element list, later entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['a']), 'b')
      expect(result.toJS()).toEqual(['a', 'b'])
    })

    test('should insert into a two element list, early entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['b', 'c']), 'a')
      expect(result.toJS()).toEqual(['a', 'b', 'c'])
    })

    test('should insert into a two element list, middle entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['a', 'c']), 'b')
      expect(result.toJS()).toEqual(['a', 'b', 'c'])
    })

    test('should insert into a two element list, later entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['a', 'b']), 'c')
      expect(result.toJS()).toEqual(['a', 'b', 'c'])
    })

    test('should insert into a list with an equal element', () => {
      const result = insert(alphaSort, create(alphaSort, ['a', 'b', 'c', 'd']), 'b')
      expect(result.toJS()).toEqual(['a', 'b', 'b', 'c', 'd'])
    })

    test('should insert into a large list', () => {
      const result = insert(
        alphaSort,
        create(alphaSort, [
          'a',
          'f',
          'f',
          'f',
          'g',
          'g',
          'g',
          'h',
          'i',
          't',
          'u',
          'v',
          'y',
          'y',
          'z',
        ]),
        'c',
      )
      expect(result.toJS()).toEqual([
        'a',
        'c',
        'f',
        'f',
        'f',
        'g',
        'g',
        'g',
        'h',
        'i',
        't',
        'u',
        'v',
        'y',
        'y',
        'z',
      ])
    })
  })
})
