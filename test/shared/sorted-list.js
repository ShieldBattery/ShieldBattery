import { expect } from 'chai'

import {
  create,
  insert,
} from '../../shared/sorted-list'

const alphaSort = (a, b) => a.localeCompare(b)

describe('sorted-list', () => {
  describe('create', () => {
    it('should create an empty list', () => {
      const result = create(alphaSort)
      expect(result.size).to.eql(0)
    })

    it('should create an filled list', () => {
      const result = create(alphaSort, [ 'z', 'a', 'b' ])
      expect(result.size).to.eql(3)
      expect(result.get(0)).to.eql('a')
      expect(result.get(1)).to.eql('b')
      expect(result.get(2)).to.eql('z')
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
