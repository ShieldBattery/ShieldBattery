module.exports = 'shieldbattery.status'
var mod = angular.module('shieldbattery.status', [ require('./auth') ])

mod.controller('StatusCtrl', function($scope, $location, authService) {
  $scope.auth = authService

  $scope.logOut = function() {
    if (!authService.isLoggedIn) return
    authService.logOut()
      .success(function() { $location.path('/') })
      .error(function() { alert('OMG LOGGING OUT FAILED') }) // TODO(tec27): :)
  }
})
