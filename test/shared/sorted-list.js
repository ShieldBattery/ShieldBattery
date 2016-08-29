import { expect } from 'chai'

import {
  create,
  findIndex,
  insert,
} from '../../shared/sorted-list'

const alphaSort = (a, b) => a.localeCompare(b)

describe('sorted-list', () => {
  describe('create', () => {
    it('should create an empty list', () => {
      const result = create(alphaSort)
      expect(result.size).to.eql(0)
    })

    it('should create a filled list', () => {
      const result = create(alphaSort, [ 'z', 'a', 'b' ])
      expect(result.size).to.eql(3)
      expect(result.get(0)).to.eql('a')
      expect(result.get(1)).to.eql('b')
      expect(result.get(2)).to.eql('z')
    })
  })

  describe('findIndex', () => {
    it('should find nothing in an empty list', () => {
      const result = findIndex(alphaSort, create(alphaSort), 'a')
      expect(result).to.eql(-1)
    })

    it('should find a single item in a one item list', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['a']), 'a')
      expect(result).to.eql(0)
    })

    it('should not find a single item in a non-equal one item list', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['b']), 'a')
      expect(result).to.eql(-1)
    })

    it('should find a single item in a three item list, early item', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['a', 'b', 'c']), 'a')
      expect(result).to.eql(0)
    })

    it('should find a single item in a three item list, middle item', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['a', 'b', 'c']), 'b')
      expect(result).to.eql(1)
    })

    it('should find a single item in a three item list, late item', () => {
      const result = findIndex(alphaSort, create(alphaSort, ['a', 'b', 'c']), 'c')
      expect(result).to.eql(2)
    })

    it('should find a single item in a large list', () => {
      const result = findIndex(alphaSort, create(alphaSort,
          ['a', 'a', 'b', 'b', 'c', 'f', 'f', 'j', 'y', 'y', 'y', 'z']), 'c')
      expect(result).to.eql(4)
    })

    it('should not find a single item in a large list, no equal item present', () => {
      const result = findIndex(alphaSort, create(alphaSort,
          ['a', 'a', 'b', 'b', 'c', 'f', 'f', 'j', 'y', 'y', 'y', 'z']), 'g')
      expect(result).to.eql(-1)
    })
  })

  describe('insert', () => {
    it('should insert into an empty list', () => {
      const result = insert(alphaSort, create(alphaSort), 'a')
      expect(result.toJS()).to.eql(['a'])
    })

    it('should insert into a one element list, earlier entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['b']), 'a')
      expect(result.toJS()).to.eql(['a', 'b'])
    })

    it('should insert into a one element list, later entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['a']), 'b')
      expect(result.toJS()).to.eql(['a', 'b'])
    })

    it('should insert into a two element list, early entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['b', 'c']), 'a')
      expect(result.toJS()).to.eql(['a', 'b', 'c'])
    })

    it('should insert into a two element list, middle entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['a', 'c']), 'b')
      expect(result.toJS()).to.eql(['a', 'b', 'c'])
    })

    it('should insert into a two element list, later entry', () => {
      const result = insert(alphaSort, create(alphaSort, ['a', 'b']), 'c')
      expect(result.toJS()).to.eql(['a', 'b', 'c'])
    })

    it('should insert into a list with an equal element', () => {
      const result = insert(alphaSort, create(alphaSort, ['a', 'b', 'c', 'd']), 'b')
      expect(result.toJS()).to.eql(['a', 'b', 'b', 'c', 'd'])
    })

    it('should insert into a large list', () => {
      const result = insert(alphaSort, create(alphaSort,
          ['a', 'f', 'f', 'f', 'g', 'g', 'g', 'h', 'i', 't', 'u', 'v', 'y', 'y', 'z']), 'c')
      expect(result.toJS()).to.eql(
          ['a', 'c', 'f', 'f', 'f', 'g', 'g', 'g', 'h', 'i', 't', 'u', 'v', 'y', 'y', 'z'])
    })
  })
})
