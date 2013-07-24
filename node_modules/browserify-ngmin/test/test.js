var test = require('tap').test
  , browserify = require('browserify')
  , path = require('path')
  , util = require('util')
  , vm = require('vm')

test('ngmin transform', function(t) {
  var b = browserify()
  b.add(path.join(__dirname, '..', 'testdata', 'sample.js'))
  b.transform(path.join(__dirname, '..'))
  b.bundle(function(err, src) {
    if (err) {
      t.fail(err)
    }

    vm.runInNewContext(src, { angular: fakeAngular(t) })
  })
})

function fakeAngular(t) {
  return {
    module: function() {
      return fakeAngularModule(t)
    }
  }
}

function fakeAngularModule(t) {
  function genDoTest(paramsToCheck) {
    return function() {
      var args = Array.prototype.slice.call(arguments, 0)
      t.equal(args.length, paramsToCheck.length, 'didn\'t receive the right number of parameters')
      for (var i = 0, len = args.length; i < len; i++) {
        t.equal(args[i], paramsToCheck[i], 'incorrect parameter received')
      }

      t.end()
    }
  }

  function controller(name, args) {
    t.ok(util.isArray(args), 'controller args should have been converted to an array')
    var argsToPass = []
    for (var i = 0, len = args.length; i < len - 1; i++) {
      if (args[i] != 'doTest') {
        argsToPass.push(args[i])
      } else {
        argsToPass.push(genDoTest(argsToPass.slice(0)))
      }
    }

    args[args.length - 1].apply(this, argsToPass)
  }

  return {
    controller: controller
  }
}
