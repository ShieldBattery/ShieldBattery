module.exports = 'shieldbattery.auth'

var mod = angular.module('shieldbattery.auth', [])
var constants = require('../util/constants.js')

mod.config(function($httpProvider, $routeProvider) {
  $routeProvider.when('/login', { templateUrl: '/partials/login', controller: 'LoginCtrl' })
    .when('/user/new', { templateUrl: '/partials/newuser', controller: 'NewUserCtrl' })

  var interceptor = ['$location', '$q', function($location, $q) {
    function onSuccess(response) {
      return response
    }

    function onError(response) {
      if (response.status == 401) {
        $location.path('/login')
      }

      return $q.reject(response)
    }

    return function(promise) { return promise.then(onSuccess, onError) }
  }]

  $httpProvider.responseInterceptors.push(interceptor)
})

mod.run(function(authService) {
  // TODO(tec27): this should only redirect from pages that require login (probably keep a list of
  // those that don't require it, since its probably fairly small)
  if (!authService.isLoggedIn) authService.redirectToLogin()
})

mod.factory('authService', function($location, $http) {
  return new AuthService($location, $http)
})

function AuthService($location, $http) {
  this.$location = $location
  this.$http = $http

  Object.defineProperty(this, 'isLoggedIn',
      { enumerable: true
      , get: function() { return !!this.user }
      })
  this.user = null
}

AuthService.prototype.redirectToLogin = function() {
  this.$location.path('/login')
}

AuthService.prototype.createUser = function(username, password, cb) {
  var req = this.$http.post('/api/1/users', { username: username, password: password })
    , self = this
  req.success(function(user) {
    self.user = user
    cb(null, user)
  }).error(function(err) {
    cb(err)
  })
}

mod.controller('LoginCtrl', function($scope, $location, authService) {
  // TODO(tec27): save return url and return to that instead
  if (authService.isLoggedIn) return $location.path('/')

  // TODO(tec27): implement this
})

mod.controller('NewUserCtrl', function($scope, $location, authService) {
  if (authService.isLoggedIn) return $location.path('/')

  $scope.usernamePattern = constants.USERNAME_PATTERN
  $scope.usernameMinLength = constants.USERNAME_MINLENGTH
  $scope.usernameMaxLength = constants.USERNAME_MAXLENGTH

  $scope.passwordMinLength = constants.PASSWORD_MINLENGTH

  $scope.btnDisabled = false
  $scope.responseError = null

  $scope.createUser = function(username, password, confirmPassword) {
    $scope.responseError = null
    if (!$scope.newUserForm.$valid) return
    if (password != confirmPassword) return // TODO(tec27): this should be a validation

    $scope.btnDisabled = true
    authService.createUser(username, password, function(err, user) {
      if (err) {
        $scope.btnDisabled = false
        console.dir(err)
        $scope.responseError = err
        return
      }

      $location.path('/')
    })
  }
})
