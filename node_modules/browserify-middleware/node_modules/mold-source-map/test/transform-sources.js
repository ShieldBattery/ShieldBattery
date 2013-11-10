'use strict';
/*jshint asi: true */

var test =        require('tap').test
  , path       =  require('path')
  , fs         =  require('fs')
  , browserify =  require('browserify')
  , convert    =  require('convert-source-map')
  , mold       =  require('..')
  , jsRoot     =  path.join(__dirname, '..', 'examples', 'project')

test('mold sources', function (t) {
  t.plan(1)

  var bundle = '';
  browserify()
    .require(require.resolve('../examples/project/js/main.js'), { entry: true })
    .bundle({ debug: true })
    .pipe(mold.transformSourcesRelativeTo(jsRoot))
    .on('error', function (err) { console.error(err); })
    .on('data', function (data) {
      bundle += data;    
    })
    .on('end', function () {
      var sm = convert.fromSource(bundle);
      t.deepEqual(sm.getProperty('sources'), [ ' js/main.js', ' js/foo.js', ' js/wunder/bar.js' ], 'molds all sources relative to js root')
    });
});
