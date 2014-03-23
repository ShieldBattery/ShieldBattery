var idgen = require('../')
  , assert = require('assert')
  ;

describe('idgen', function () {
  it('creates unique IDs', function () {
    var ids = [], id;
    for (var i = 0; i < 5000; i++) {
      id = idgen(16);
      assert.strictEqual(typeof id, 'string', 'id is string');
      assert.strictEqual(id.indexOf('undefined'), -1, 'no "undefined" in id');
      assert.strictEqual(ids.indexOf(id), -1, 'id is unique');
      assert.strictEqual(id.length, 16, 'id is custom length');
      ids.push(id);
    }
  });
});