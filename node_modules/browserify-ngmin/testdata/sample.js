/* global angular */
var mod = angular.module('sample', [])

mod.controller('SampleCtrl', function(test, dependencies, woo, doTest) {
  doTest(test, dependencies, woo)
})
