module.exports = 'shieldbattery.status'
var mod = angular.module('shieldbattery.status', [ require('./auth') ])

mod.controller('StatusCtrl', function($scope, $location, authService, siteSocket, psiSocket) {
  $scope.auth = authService

  $scope.logOut = function() {
    if (!authService.isLoggedIn) return
    authService.logOut()
      .success(function() { $location.path('/') })
      .error(function() { alert('OMG LOGGING OUT FAILED') }) // TODO(tec27): :)
  }

  $scope.siteSocket = siteSocket
  $scope.psiSocket = psiSocket

  $scope.retryPsi = function() {
    if (!psiSocket.connected) psiSocket.connect()
  }
})
