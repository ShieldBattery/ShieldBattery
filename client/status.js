module.exports = 'shieldbattery.status'
var angular = require('angular')

var mod = angular.module('shieldbattery.status', [ require('./auth'), require('./lobby') ])

mod.controller('StatusCtrl', function($scope, $location, authService, siteSocket, psiSocket,
    joinedLobby) {
  $scope.auth = authService
  $scope.joinedLobby = joinedLobby

  $scope.logOut = function() {
    if (!authService.isLoggedIn) return
    authService.logOut()
      .success(function() { $location.path('/') })
      .error(function() { window.alert('OMG LOGGING OUT FAILED') }) // TODO(tec27): :)
  }

  $scope.siteSocket = siteSocket
  $scope.psiSocket = psiSocket

  $scope.retryPsi = function() {
    if (!psiSocket.connected) psiSocket.connect()
  }

  $scope.leaveLobby = function() {
    joinedLobby.leave()
  }

  $scope.showAdminLink = function() {
    if (!$scope.auth.permissions) return false

    return $scope.auth.permissions.editPermissions ||
      $scope.auth.permissions.debug ||
      $scope.auth.permissions.acceptInvites
  }
})
