import listUtils from '../../shared/list-utils'

import { expect } from 'chai'

function compare(a, b) {
  return a.localeCompare(b)
}

describe('list-utils', function() {
  describe('#replaceInPlace', function() {
    it('should handle a completely empty original list', function() {
      const a = []
        , desired = [ 'a', 'b', 'c' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a completely empty desired list', function() {
      const a = [ 'a', 'b', 'c' ]
      listUtils.replaceInPlace(a, [], compare)

      expect(a).to.have.length(0)
    })

    it('should handle desired as a subset of original at the front', function() {
      const a = [ 'a', 'b', 'c' ]
        , desired = [ 'a', 'b' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle desired as a subset of original in the middle', function() {
      const a = [ 'a', 'b', 'c', 'd' ]
        , desired = [ 'b', 'c' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle desired as a subset of original at the end', function() {
      const a = [ 'a', 'b', 'c' ]
        , desired = [ 'b', 'c' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a mix of additions and deletions at the front', function() {
      const a = [ 'a', 'c', 'd', 'e' ]
        , desired = [ 'b', 'c', 'd', 'e' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a mix of additions and deletions in the middle', function() {
      const a = [ 'a', 'c', 'e', 'g' ]
        , desired = [ 'a', 'b', 'd', 'e', 'g' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a mix of additions and deletions at the end', function() {
      const a = [ 'a', 'c', 'e', 'g' ]
        , desired = [ 'a', 'c', 'e', 'f', 'h' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle completely distinct lists (o < d)', function() {
      const a = [ 'a', 'b', 'c' ]
        , desired = [ 'x', 'y', 'z' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle completely distinct lists (o > d)', function() {
      const a = [ 'x', 'y', 'z' ]
        , desired = [ 'a', 'b', 'c' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle completely distinct lists (o ~ d)', function() {
      const a = [ 'a', 'c', 'e' ]
        , desired = [ 'b', 'd', 'f' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a crazy combination of additions and deletions', function() {
      const a = [ 'b', 'c', 'd', 'e', 'h', 'i', 'j', 'k' ]
        , desired = [ 'a', 'd', 'e', 'f', 'g', 'j', 'k', 'l', 'm', 'n', 'o' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })
  })

  describe('#sortedInsert', function() {
    it('should handle an empty list', function() {
      const list = []
        , value = 'a'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(0)
      expect(list).to.eql([ 'a' ])
    })

    it('should handle inserting at the beginning', function() {
      const list = [ 'b', 'c', 'd' ]
        , value = 'a'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(0)
      expect(list).to.eql([ 'a', 'b', 'c', 'd' ])
    })

    it('should handle inserting in the middle', function() {
      const list = [ 'a', 'b', 'd' ]
        , value = 'c'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(2)
      expect(list).to.eql([ 'a', 'b', 'c', 'd' ])
    })

    it('should handle inserting at the end', function() {
      const list = [ 'a', 'b', 'c' ]
        , value = 'd'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(3)
      expect(list).to.eql([ 'a', 'b', 'c', 'd' ])
    })

    it('should handle equal values by inserting after', function() {
      const list = [ 'a', 'b', 'c' ]
        , value = 'b'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(2)
      expect(list).to.eql([ 'a', 'b', 'b', 'c' ])
    })
  })
})
