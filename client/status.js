module.exports = 'shieldbattery.status'
var mod = angular.module('shieldbattery.status', [ require('./auth') ])

mod.controller('StatusCtrl', function($scope, authService) {
  $scope.auth = authService
})
