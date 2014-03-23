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
  it('creates based on buffer', function () {
    var str = idgen(Buffer('8da307895368fcca53995503407f950c3291eb1d34af51237f500ac7e5bdf009', 'hex'));
    assert.equal(str, 'jaMHiVNo_MpTmVUDQH-VDDKR6x00r1Ejf1AKx-W98Ak');
    str = idgen(16, Buffer('8da307895368fcca53995503407f950c3291eb1d34af51237f500ac7e5bdf009', 'hex'));
    assert.equal(str, 'jaMHiVNo_MpTmVUD');
  });
});