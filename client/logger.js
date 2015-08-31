module.exports = 'shieldbattery.logger'

var angular = require('angular')

var mod = angular.module('shieldbattery.logger', [ require('./auth'), require('./sockets') ])

mod.factory('logger', function(siteSocket, psiSocket) {
  return new LoggerService(siteSocket, psiSocket);
})

function LoggerService(siteSocket, psiSocket) {
  this.siteSocket = siteSocket
  this.psiSocket = psiSocket
  this.logs = []

  var self = this
  this.siteSocket.on('message', function(message) {
    self.logs.push({message: message, source: 'siteSocket'})
  })

  this.psiSocket.on('message', function(message) {
    self.logs.push({message: message, source: 'psiSocket'})
  })
}

mod.controller('LoggerCtrl', function($scope, authService, logger) {
  $scope.auth = authService
  $scope.logger = logger
  $scope.showLogs = false

  $scope.toggleLogs = function() {
    $scope.showLogs = !$scope.showLogs
  }

  $scope.clearLogs = function() {
    $scope.logger.logs = []
  }

  $scope.showLogsButton = function() {
    if (!$scope.auth.permissions) return false

    return $scope.auth.permissions.debug
  }
})
