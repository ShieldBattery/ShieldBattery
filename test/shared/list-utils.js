var listUtils = require('../../shared/list-utils')

var expect = require('chai').expect

function compare(a, b) {
  return a.localeCompare(b)
}

describe('list-utils', function() {
  describe('#replaceInPlace', function() {
    it('should handle a completely empty original list', function() {
      var a = []
        , desired = [ 'a', 'b', 'c' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a completely empty desired list', function() {
      var a = [ 'a', 'b', 'c' ]
      listUtils.replaceInPlace(a, [], compare)

      expect(a).to.have.length(0)
    })

    it('should handle desired as a subset of original at the front', function() {
      var a = [ 'a', 'b', 'c' ]
        , desired = [ 'a', 'b' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle desired as a subset of original in the middle', function() {
      var a = [ 'a', 'b', 'c', 'd' ]
        , desired = [ 'b', 'c' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle desired as a subset of original at the end', function() {
      var a = [ 'a', 'b', 'c' ]
        , desired = [ 'b', 'c' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a mix of additions and deletions at the front', function() {
      var a = [ 'a', 'c', 'd', 'e' ]
        , desired = [ 'b', 'c', 'd', 'e' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a mix of additions and deletions in the middle', function() {
      var a = [ 'a', 'c', 'e', 'g' ]
        , desired = [ 'a', 'b', 'd', 'e', 'g' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a mix of additions and deletions at the end', function() {
      var a = [ 'a', 'c', 'e', 'g' ]
        , desired = [ 'a', 'c', 'e', 'f', 'h' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle completely distinct lists (o < d)', function() {
      var a = [ 'a', 'b', 'c' ]
        , desired = [ 'x', 'y', 'z' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle completely distinct lists (o > d)', function() {
      var a = [ 'x', 'y', 'z' ]
        , desired = [ 'a', 'b', 'c' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle completely distinct lists (o ~ d)', function() {
      var a = [ 'a', 'c', 'e' ]
        , desired = [ 'b', 'd', 'f' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })

    it('should handle a crazy combination of additions and deletions', function() {
      var a = [ 'b', 'c', 'd', 'e', 'h', 'i', 'j', 'k' ]
        , desired = [ 'a', 'd', 'e', 'f', 'g', 'j', 'k', 'l', 'm', 'n', 'o' ]
      listUtils.replaceInPlace(a, desired, compare)

      expect(a).to.eql(desired)
    })
  })

  describe('#sortedInsert', function() {
    it('should handle an empty list', function() {
      var list = []
        , value = 'a'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(0)
      expect(list).to.eql([ 'a' ])
    })

    it('should handle inserting at the beginning', function() {
      var list = [ 'b', 'c', 'd' ]
        , value = 'a'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(0)
      expect(list).to.eql([ 'a', 'b', 'c', 'd' ])
    })

    it('should handle inserting in the middle', function() {
      var list = [ 'a', 'b', 'd' ]
        , value = 'c'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(2)
      expect(list).to.eql([ 'a', 'b', 'c', 'd' ])
    })

    it('should handle inserting at the end', function() {
      var list = [ 'a', 'b', 'c' ]
        , value = 'd'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(3)
      expect(list).to.eql([ 'a', 'b', 'c', 'd' ])
    })

    it('should handle equal values by inserting after', function() {
      var list = [ 'a', 'b', 'c' ]
        , value = 'b'
        , result = listUtils.sortedInsert(list, value, compare)

      expect(result).to.eql(2)
      expect(list).to.eql([ 'a', 'b', 'b', 'c' ])
    })
  })
})
