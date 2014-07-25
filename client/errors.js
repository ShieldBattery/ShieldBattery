var modName = 'shieldbattery.errors'
module.exports = modName

var angular = require('angular')

var mod = angular.module(modName, [])

mod.controller('ErrorsCtrl', function($scope, $rootScope, $location) {
  $scope.routeError = null
  var errorTriggeredChange = false

  $scope.clearRouteError = function() {
    $scope.routeError = null
  }

  $rootScope.$on('$routeChangeStart', function() {
    if (!errorTriggeredChange) {
      $scope.routeError = null
    } else {
      errorTriggeredChange = false
    }
  })

  $rootScope.$on('$routeChangeError', function(event, current, previous, rejection) {
    if (typeof rejection == 'string') {
      $scope.routeError = rejection
    } else if (rejection && rejection.msg) {
      $scope.routeError = rejection.msg
    } else {
      $scope.routeError = 'Could not navigate to the requested page'
    }

    if (!previous) {
      // user was loading an erroneous URI directly, send them to the index so they at least see a
      // fully loaded page with content
      errorTriggeredChange = true
      $location.path('/')
    }
  })
})
