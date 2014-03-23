var idgen_hex = require('../').hex
  , assert = require('assert')

describe('idgen_hex', function () {
  it('creates unique hex IDs', function () {
    var ids = [], id;
    for (var i = 0; i < 5000; i++) {
      id = idgen_hex(20);
      assert.strictEqual(typeof id, 'string', 'id is string');
      assert.strictEqual(id.indexOf('undefined'), -1, 'no "undefined" in id');
      assert.strictEqual(ids.indexOf(id), -1, 'id is unique');
      assert.ok(id.match(/^[0-9a-f]{20}$/), 'id is hex and correct length');
      ids.push(id);
    }
  });
});
