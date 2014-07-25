module.exports = 'shieldbattery.admin'

var checkPermissions = require('./util/check-permissions')
  , angular = require('angular')
require('angular-route')


var mod = angular.module('shieldbattery.admin', [ require('./auth'), 'ngRoute' ])

mod.config(function($routeProvider) {
  $routeProvider.when('/admin', { templateUrl: '/partials/admin'
                                , controller: 'AdminCtrl'
                                , resolve: { perm: hasAdmin }
                                })
    .when('/admin/permissions', { templateUrl: '/partials/permissions'
                                , controller: 'PermissionsCtrl'
                                , resolve: { perm: checkPermissions('editPermissions') }
                                })
    .when('/admin/invites', { templateUrl: '/partials/invites'
                            , controller: 'InvitesCtrl'
                            , resolve: { perm: checkPermissions('acceptInvites') }
                            })
})

function hasAdmin(authService, $q) {
  var deferred = $q.defer()
  if (!authService.permissions) {
    deferred.reject('Not enough permissions')
    return deferred.promise
  }

  for (var key in authService.permissions) {
    if (authService.permissions[key]) {
      deferred.resolve()
      return deferred.promise
    }
  }

  deferred.reject('Not enough permissions')
  return deferred.promise
}

mod.controller('AdminCtrl', function($scope, authService) {
  $scope.auth = authService
})

mod.controller('PermissionsCtrl', function($http, $scope, authService) {
  $scope.auth = authService
  $scope.user = null
  $scope.permissions = null
  $scope.noResult = false
  $scope.firstSearch = true

  $scope.findUser = function() {
    if (!$scope.findUserForm.$valid) return

    $scope.error = null
    $http.get('api/1/users/' + encodeURIComponent($scope.searchTerm))
      .success(function(user) {
        $scope.noResult = !user.length
        if ($scope.noResult) {
          $scope.user = null
          return
        }

        $scope.user = user[0]
        $http.get('api/1/permissions/' + $scope.user.id)
          .success(function(permissions) {
            $scope.permissions = permissions
          }).error(function(err) {
            $scope.error = err
            $scope.permissions = null
          })
      }).error(function(err) {
        $scope.error = err
        $scope.user = null
        $scope.noResult = true
      }).finally(function() {
        $scope.firstSearch = false
      })
  }

  $scope.updatePermissions = function() {
    $http.post('api/1/permissions/' + $scope.user.id,
      { editPermissions: $scope.permissions.editPermissions
      , debug: $scope.permissions.debug
      , acceptInvites: $scope.permissions.acceptInvites
      })
      .success(function(permissions) {
        $scope.permissions = permissions
      }).error(function(err) {
        $scope.error = err
      })
  }
})

mod.controller('InvitesCtrl', function() {
})
