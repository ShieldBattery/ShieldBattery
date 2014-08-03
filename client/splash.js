module.exports = 'shieldbattery.splash'
var angular = require('angular')

var mod = angular.module('shieldbattery.splash', [])

mod.config(function($routeProvider) {
  $routeProvider.when('/signup',
      { templateUrl: '/partials/inviteSignup', controller: 'InviteSignupCtrl' })
    .when('/splash',
      { templateUrl: '/partials/splash', controller: 'SplashCtrl' })
})

mod.controller('InviteSignupCtrl', function($scope, $http) {
  $scope.done = false
  $scope.error = null

  $scope.signUp = function(email, teamliquidName, os, browser, graphics, canHost) {
    if (!$scope.signupForm.$valid) return

    $http.post('/api/1/invites',
        { email: email
        , teamliquidName: teamliquidName
        , os: os
        , browser: browser
        , graphics: graphics
        , canHost: canHost
        })
      .success(function() {
        $scope.done = true
      }).error(function(err) {
        $scope.error = err
      })
  }
})

mod.controller('SplashCtrl', function($scope) {
})
